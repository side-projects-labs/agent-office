"use strict";

/**
 * Claude Code gateway adapter.
 *
 * Observe mode (default): tails events.jsonl written by claude-code/hook.js,
 * translates hook events to Claw3D gateway frames (claude-code/core.js), and
 * serves them over the gateway WebSocket protocol (claude-code/methods.js).
 *
 * Runner mode (opt-in): configure at least one workspace (AGENT_OFFICE_WORKDIR
 * or ~/.agent-office/config.json, see claude-code/config.js). Avatars created
 * from the UI then run work via `claude -p` (claude-code/runner.js) in their
 * workspace, and permission requests are answered from the UI.
 */

const http = require("http");
const os = require("os");
const path = require("path");
const { randomUUID } = require("crypto");
const { WebSocketServer } = require("ws");

const { createState, applyHookEvent } = require("./claude-code/core");
const { createHandler, buildHello, resOk, resErr } = require("./claude-code/methods");
const { createRunner } = require("./claude-code/runner");
const { loadConfig } = require("./claude-code/config");
const { createProfileStore } = require("./claude-code/store");
const { createTail } = require("./claude-code/tail");

const PORT = parseInt(process.env.CLAUDE_ADAPTER_PORT || process.env.DEMO_ADAPTER_PORT || "18789", 10);
const EVENTS_PATH =
  process.env.AGENT_OFFICE_EVENTS || path.join(os.homedir(), ".agent-office", "events.jsonl");
const runnerConfig = loadConfig();
const POLL_MS = 300;
const APPROVAL_TTL_MS = 9 * 60 * 1000;

const state = createState();
const baseHandler = createHandler(state);
const clients = new Set();
const pendingApprovals = new Map(); // id -> { resolve, timer }

const randomId = () => randomUUID().replace(/-/g, "");

function broadcast(frame) {
  for (const send of clients) {
    try {
      send(frame);
    } catch {}
  }
}

let runner = null;

function setupRunner() {
  for (const warning of runnerConfig.warnings) console.warn(`[claude-code-adapter] ${warning}`);
  if (runnerConfig.workspaces.length === 0) return null;
  const store = createProfileStore();
  const created = createRunner({
    state,
    broadcast,
    workspaces: runnerConfig.workspaces,
    defaultWorkspaceId: runnerConfig.defaultWorkspaceId,
    store,
    eventsPath: EVENTS_PATH,
    adapterUrl: `http://127.0.0.1:${PORT}`,
    log: (m) => console.log(m),
  });
  const restored = created.restore(store.load());
  if (restored > 0) console.log(`[claude-code-adapter] restored ${restored} avatar(s) from ${store.file}`);
  return created;
}

async function handleMethod(method, params, id) {
  const p = params || {};
  if (runner) {
    switch (method) {
      case "agents.create": {
        try {
          const agent = runner.createAgent({
            name: p.name,
            role: p.role,
            workspaceId: typeof p.workspaceId === "string" ? p.workspaceId : undefined,
          });
          return resOk(id, { agentId: agent.id, name: agent.name, workspace: agent.workspace });
        } catch (err) {
          return resErr(id, err.code || "create_failed", err.message);
        }
      }
      case "agents.update": {
        const agentId = typeof p.agentId === "string" ? p.agentId : "";
        if (typeof p.name === "string" && !runner.renameAgent(agentId, p.name)) break;
        return resOk(id, { ok: true, removedBindings: 0 });
      }
      case "agents.files.get": {
        const agentId = typeof p.agentId === "string" ? p.agentId : "";
        if (!state.agents.get(agentId)?.managed) break;
        const content = runner.getFile(agentId, String(p.name || ""));
        return resOk(id, { file: content !== undefined ? { content } : { missing: true } });
      }
      case "agents.files.set": {
        const agentId = typeof p.agentId === "string" ? p.agentId : "";
        if (!state.agents.get(agentId)?.managed) break;
        if (!runner.setFile(agentId, String(p.name || ""), p.content)) {
          return resErr(id, "invalid_file", "Invalid file name.");
        }
        return resOk(id, {});
      }
      case "agents.delete": {
        runner.removeAgent(typeof p.agentId === "string" ? p.agentId : "");
        return resOk(id, { ok: true, removedBindings: 0 });
      }
      case "chat.send": {
        const sessionKey = typeof p.sessionKey === "string" ? p.sessionKey : "";
        const agentId = sessionKey.startsWith("agent:") ? sessionKey.split(":")[1] : "";
        const runId = typeof p.idempotencyKey === "string" && p.idempotencyKey ? p.idempotencyKey : randomId();
        const result = runner.send({ agentId, message: p.message, runId });
        if (!result.ok) return resErr(id, result.code, result.message);
        return resOk(id, { status: "started", runId });
      }
      case "chat.abort": {
        const aborted = runner.abort({
          runId: typeof p.runId === "string" ? p.runId.trim() : "",
          agentId: typeof p.sessionKey === "string" && p.sessionKey.startsWith("agent:") ? p.sessionKey.split(":")[1] : "",
        });
        return resOk(id, { ok: true, aborted });
      }
      case "exec.approval.resolve": {
        const approvalId = typeof p.id === "string" ? p.id : "";
        const pending = pendingApprovals.get(approvalId);
        if (!pending) return resOk(id, { ok: true });
        // The runner only grants one-shot approvals (the UI hides "Always allow").
        const decision = p.decision === "allow-once" || p.decision === "allow-always" ? "allow-once" : "deny";
        pending.resolve(decision, "ui");
        return resOk(id, { ok: true });
      }
      default:
        break;
    }
  }
  return baseHandler(method, params, id);
}

/** POST /approval from approval-hook.js: hold the request until the UI decides. */
function handleApprovalRequest(req, res) {
  const remote = req.socket.remoteAddress || "";
  if (!(remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1")) {
    res.writeHead(403).end();
    return;
  }
  let body = "";
  req.setEncoding("utf8");
  req.on("data", (c) => {
    body += c;
    if (body.length > 1_000_000) req.destroy();
  });
  req.on("end", () => {
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const agent = state.agents.get(data.agent_id);
    if (!runner || !agent || !agent.managed) {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ decision: "deny" }));
      return;
    }
    const createdAtMs = Date.now();
    const id = `approval-${randomId().slice(0, 12)}`;
    const input = data.tool_input && typeof data.tool_input === "object" ? data.tool_input : {};
    const command =
      typeof input.command === "string" && input.command
        ? input.command
        : `${data.tool_name || "tool"} ${JSON.stringify(input).slice(0, 200)}`;

    let settled = false;
    const settle = (decision, by) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pendingApprovals.delete(id);
      broadcast({
        type: "event",
        event: "exec.approval.resolved",
        payload: { id, decision, resolvedBy: by, ts: Date.now() },
      });
      if (!res.writableEnded) {
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ decision }));
      }
    };
    const timer = setTimeout(() => settle("deny", "timeout"), APPROVAL_TTL_MS);
    pendingApprovals.set(id, { resolve: settle });
    // If the hook process goes away (run aborted), drop the prompt from the UI.
    res.on("close", () => settle("deny", "closed"));

    broadcast({
      type: "event",
      event: "exec.approval.requested",
      payload: {
        id,
        request: {
          command,
          cwd: typeof data.cwd === "string" ? data.cwd : agent.workspace,
          agentId: agent.id,
          sessionKey: `agent:${agent.id}:main`,
        },
        createdAtMs,
        expiresAtMs: createdAtMs + APPROVAL_TTL_MS,
      },
    });
  });
}

function ingestLine(line) {
  let ev;
  try {
    ev = JSON.parse(line);
  } catch {
    return;
  }
  const { frames } = applyHookEvent(state, ev);
  for (const frame of frames) broadcast(frame);
}

function startTail() {
  return createTail({
    file: EVENTS_PATH,
    onLine: ingestLine,
    maxBytes: Number(process.env.AGENT_OFFICE_EVENTS_MAX_BYTES) || undefined,
    pollMs: POLL_MS,
  });
}

function startAdapter() {
  runner = setupRunner();

  const httpServer = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/approval") {
      handleApprovalRequest(req, res);
      return;
    }
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(`Claw3D Claude Code Gateway Adapter (${runner ? "runner" : "observe-only"})\n`);
  });
  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (ws) => {
    let connected = false;
    let globalSeq = 0;
    const send = (frame) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
    };
    const sendEvent = (frame) => {
      // One monotonic seq per connection; core frames carry no seq of their own.
      send(frame.type === "event" ? { ...frame, seq: globalSeq++ } : frame);
    };
    clients.add(sendEvent);
    send({ type: "event", event: "connect.challenge", payload: { nonce: randomId() } });

    ws.on("message", async (raw) => {
      let frame;
      try {
        frame = JSON.parse(raw.toString("utf8"));
      } catch {
        return;
      }
      if (!frame || frame.type !== "req") return;
      const { id, method, params } = frame;
      if (typeof id !== "string" || typeof method !== "string") return;

      if (method === "connect") {
        connected = true;
        send({
          type: "res",
          id,
          ok: true,
          payload: buildHello(state, {
            readOnly: !runner,
            runner: runner
              ? {
                  workspaces: runner.config.workspaces.map((w) => ({ id: w.id, label: w.label })),
                  defaultWorkspaceId: runner.config.defaultWorkspaceId,
                }
              : undefined,
          }),
        });
        return;
      }
      if (!connected) return send(resErr(id, "not_connected", "Send connect first."));
      try {
        send(await handleMethod(method, params, id));
      } catch (error) {
        send(resErr(id, "internal_error", error instanceof Error ? error.message : "Internal error"));
      }
    });
    ws.on("close", () => clients.delete(sendEvent));
    ws.on("error", () => clients.delete(sendEvent));
  });

  startTail();
  httpServer.listen(PORT, "127.0.0.1", () => {
    console.log(`[claude-code-adapter] ws://localhost:${PORT} (${runner ? "runner" : "observe-only"})`);
    console.log(`[claude-code-adapter] tailing ${EVENTS_PATH}`);
    if (runner) {
      const c = runner.config;
      for (const w of c.workspaces) {
        console.log(`[claude-code-adapter] workspace ${w.id}${w.id === c.defaultWorkspaceId ? " (default)" : ""}: ${w.path}`);
      }
      console.log(`[claude-code-adapter] model ${c.model}, max ${c.maxTurns} turns, est. budget cap $${c.maxBudgetUsd}/run`);
      console.log(`[claude-code-adapter] persona: ${c.persona ? "on (default: Korean replies, code untouched)" : "off"}`);
      console.log(
        c.allowedTools.length > 0
          ? `[claude-code-adapter] auto-allowed tools: ${c.allowedTools.join(", ")} (everything else asks in the UI)`
          : "[claude-code-adapter] reads inside the workspace run automatically; everything else asks in the UI",
      );
      console.log(
        c.allowApiKey
          ? "[claude-code-adapter] WARNING: AGENT_OFFICE_ALLOW_API_KEY=1, runs may bill your API key"
          : "[claude-code-adapter] ANTHROPIC_API_KEY is removed from runner processes (uses your Claude login)",
      );
    }
  });

  const shutdown = () => {
    runner?.stopAll();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (require.main === module) startAdapter();

module.exports = { startAdapter, ingestLine, state };
