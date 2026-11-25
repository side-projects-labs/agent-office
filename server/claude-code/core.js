"use strict";

/**
 * Pure translation layer: Claude Code hook events -> Claw3D gateway frames.
 * No I/O here so it can be unit tested and reused by live and replay modes.
 *
 * Hook line format (written by hook.js):
 *   { ts, event, session_id, cwd, tool_name, tool_input, tool_use_id,
 *     prompt, message, notification_type }
 */

const basename = (p) => String(p).replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "";

const MAX_ARG_CHARS = 200;
const APPROVAL_TTL_MS = 10 * 60 * 1000;

function createState() {
  return { agents: new Map(), seq: 0 };
}

function agentIdFor(sessionId) {
  return `cc-${String(sessionId).replace(/[^a-zA-Z0-9]/g, "").slice(0, 8)}`;
}

function sessionKeyFor(agentId) {
  return `agent:${agentId}:main`;
}

function truncate(value) {
  if (typeof value === "string") {
    return value.length > MAX_ARG_CHARS ? `${value.slice(0, MAX_ARG_CHARS)}…` : value;
  }
  if (Array.isArray(value)) return value.map(truncate);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, truncate(v)]));
  }
  return value;
}

function agentPayload(agent) {
  return {
    id: agent.id,
    name: agent.name,
    workspace: agent.workspace,
    identity: { name: agent.name, emoji: "🤖" },
    role: agent.role,
  };
}

function presenceFrame(state) {
  const recent = [...state.agents.values()].map((a) => ({
    key: sessionKeyFor(a.id),
    updatedAt: a.updatedAt,
  }));
  return {
    type: "event",
    event: "presence",
    payload: {
      sessions: {
        recent,
        byAgent: [...state.agents.values()].map((a) => ({
          agentId: a.id,
          recent: recent.filter((r) => r.key === sessionKeyFor(a.id)),
        })),
      },
    },
  };
}

function ensureAgent(state, ev) {
  const sessionId = ev.session_id;
  if (!sessionId) return { agent: null, created: false };
  const id = agentIdFor(sessionId);
  let agent = state.agents.get(id);
  if (agent) {
    agent.updatedAt = ev.ts || Date.now();
    return { agent, created: false };
  }
  const cwd = typeof ev.cwd === "string" && ev.cwd ? ev.cwd : "/unknown";
  agent = {
    id,
    sessionId,
    name: basename(cwd) || "claude",
    role: "Claude Code",
    workspace: cwd,
    runId: null,
    pendingApprovalId: null,
    history: [],
    updatedAt: ev.ts || Date.now(),
  };
  state.agents.set(id, agent);
  return { agent, created: true };
}

function agentFrame(agent, stream, data, state) {
  return {
    type: "event",
    event: "agent",
    seq: state.seq++,
    payload: { runId: agent.runId, sessionKey: sessionKeyFor(agent.id), stream, data },
  };
}

function chatFrame(agent, chatState, extra, state) {
  return {
    type: "event",
    event: "chat",
    seq: state.seq++,
    payload: { runId: agent.runId, sessionKey: sessionKeyFor(agent.id), state: chatState, ...extra },
  };
}

function startRun(agent, ev, state, frames) {
  agent.runId = `run-${agent.id}-${ev.ts || Date.now()}`;
  frames.push(agentFrame(agent, "lifecycle", { phase: "start" }, state));
}

function resolveApproval(agent, ev, state, frames) {
  if (!agent.pendingApprovalId) return;
  frames.push({
    type: "event",
    event: "exec.approval.resolved",
    seq: state.seq++,
    payload: {
      id: agent.pendingApprovalId,
      decision: "allow-once",
      resolvedBy: "claude-code",
      ts: ev.ts || Date.now(),
    },
  });
  agent.pendingApprovalId = null;
}

/**
 * Apply one hook event to state. Returns { frames, agentsChanged }.
 * `agentsChanged` tells the caller to refresh agents.list / presence for clients.
 */
function applyHookEvent(state, ev) {
  const frames = [];
  let agentsChanged = false;
  if (!ev || typeof ev.event !== "string") return { frames, agentsChanged };

  const { agent, created } = ensureAgent(state, ev);
  if (!agent) return { frames, agentsChanged };
  if (created) agentsChanged = true;

  switch (ev.event) {
    case "SessionStart":
      break;

    case "UserPromptSubmit": {
      resolveApproval(agent, ev, state, frames);
      startRun(agent, ev, state, frames);
      if (typeof ev.prompt === "string") {
        agent.history.push({ role: "user", content: ev.prompt });
      }
      break;
    }

    case "PreToolUse": {
      resolveApproval(agent, ev, state, frames);
      if (!agent.runId) startRun(agent, ev, state, frames);
      frames.push(
        agentFrame(
          agent,
          "tool",
          {
            phase: "start",
            name: ev.tool_name || "tool",
            toolCallId: ev.tool_use_id || "",
            arguments: truncate(ev.tool_input ?? null),
          },
          state,
        ),
      );
      break;
    }

    case "PostToolUse": {
      resolveApproval(agent, ev, state, frames);
      if (!agent.runId) startRun(agent, ev, state, frames);
      frames.push(
        agentFrame(
          agent,
          "tool",
          {
            phase: "result",
            name: ev.tool_name || "tool",
            toolCallId: ev.tool_use_id || "",
          },
          state,
        ),
      );
      break;
    }

    case "Notification": {
      if (ev.notification_type === "idle_prompt") break;
      const createdAtMs = ev.ts || Date.now();
      const id = `approval-${agent.id}-${createdAtMs}`;
      agent.pendingApprovalId = id;
      frames.push({
        type: "event",
        event: "exec.approval.requested",
        seq: state.seq++,
        payload: {
          id,
          request: {
            command: typeof ev.message === "string" && ev.message ? ev.message : "Permission requested",
            cwd: agent.workspace,
            agentId: agent.id,
            sessionKey: sessionKeyFor(agent.id),
          },
          createdAtMs,
          expiresAtMs: createdAtMs + APPROVAL_TTL_MS,
        },
      });
      break;
    }

    case "Stop": {
      resolveApproval(agent, ev, state, frames);
      if (!agent.runId) break;
      const text = "Done.";
      agent.history.push({ role: "assistant", content: text });
      frames.push(
        chatFrame(agent, "final", { stopReason: "end_turn", message: { role: "assistant", content: text } }, state),
      );
      frames.push(agentFrame(agent, "lifecycle", { phase: "end" }, state));
      agent.runId = null;
      break;
    }

    case "SessionEnd": {
      state.agents.delete(agent.id);
      agentsChanged = true;
      break;
    }

    default:
      break;
  }

  if (agentsChanged) frames.push(presenceFrame(state));
  return { frames, agentsChanged };
}

module.exports = {
  createState,
  applyHookEvent,
  agentIdFor,
  sessionKeyFor,
  agentPayload,
  presenceFrame,
};
