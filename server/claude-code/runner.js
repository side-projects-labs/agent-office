"use strict";

/**
 * Runner: lets the office give work to "runner avatars" by spawning
 *   claude -p --output-format stream-json
 * once per instruction (the same Claude Code engine, headless). Node only.
 *
 * - Runner avatars are created from the UI ("Add"); observed interactive
 *   sessions are never controlled.
 * - Lifecycle/tool frames come from hooks (hook.js, injected per process via
 *   --settings, so the user's own Claude Code settings are untouched).
 *   The runner only emits chat text from the stream.
 * - Permission requests go through approval-hook.js -> adapter -> UI.
 * - ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN are stripped from the child env by
 *   default so a stray key in the shell does not silently switch to API billing.
 */

const { spawn } = require("child_process");
const { randomUUID } = require("crypto");
const path = require("path");

const { createManagedAgent, chatEvent, presenceFrame } = require("./core");

const DEFAULT_PERSONA = [
  "당신은 이 사무실에서 일하는 AI 동료입니다.",
  "모든 대답, 설명, 진행 상황 보고, 질문은 한국어 존댓말로 간결하게 하세요.",
  "단, 코드는 번역하지 마세요. 코드 블록, 명령어, 파일 경로, 변수·함수·클래스 이름, 에러 메시지 원문, 코드 주석, 커밋 메시지는 원문 그대로 두고, 코드 바깥의 설명만 한국어로 하세요.",
].join("\n");

/** AGENT_OFFICE_PERSONA: custom text replaces the default; "off" disables it. */
function resolvePersona(value) {
  if (value === undefined || value === null || value === "") return DEFAULT_PERSONA;
  if (String(value).trim().toLowerCase() === "off") return "";
  return String(value);
}

const slugify = (s) =>
  String(s || "agent").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agent";

function hookSettings(hookPath, approvalHookPath) {
  const cmd = (p) => `node ${JSON.stringify(p)}`;
  const observe = [{ hooks: [{ type: "command", command: cmd(hookPath) }] }];
  const observeTools = [{ matcher: "*", hooks: [{ type: "command", command: cmd(hookPath) }] }];
  return {
    hooks: {
      SessionStart: observe,
      UserPromptSubmit: observe,
      PreToolUse: observeTools,
      PostToolUse: observeTools,
      Stop: observe,
      SessionEnd: observe,
      PermissionRequest: [
        { matcher: "*", hooks: [{ type: "command", command: cmd(approvalHookPath), timeout: 600 }] },
      ],
    },
  };
}

function createRunner(options) {
  const {
    state,
    broadcast,
    workdir,
    eventsPath,
    adapterUrl,
    claudeBin = process.env.AGENT_OFFICE_CLAUDE_BIN || "claude",
    model = process.env.AGENT_OFFICE_MODEL || "claude-sonnet-5-5",
    maxBudgetUsd = Number(process.env.AGENT_OFFICE_MAX_BUDGET_USD || 1),
    maxTurns = Number(process.env.AGENT_OFFICE_MAX_TURNS || 20),
    allowedTools = ["Read", "Glob", "Grep"],
    allowApiKey = process.env.AGENT_OFFICE_ALLOW_API_KEY === "1",
    persona = resolvePersona(process.env.AGENT_OFFICE_PERSONA),
    log = () => {},
  } = options;

  const hookPath = path.join(__dirname, "hook.js");
  const approvalHookPath = path.join(__dirname, "approval-hook.js");
  const running = new Map(); // agentId -> { child, runId, aborted }

  function createAgent({ name, role }) {
    const label = String(name || "").trim() || "Claude";
    const id = `run-${slugify(label)}-${randomUUID().slice(0, 6)}`;
    const agent = createManagedAgent(state, {
      id,
      name: label,
      role,
      workspace: workdir,
      sessionId: randomUUID(),
    });
    broadcast(presenceFrame(state));
    return agent;
  }

  function removeAgent(agentId) {
    abort({ agentId });
    const removed = state.agents.delete(agentId);
    if (removed) broadcast(presenceFrame(state));
    return removed;
  }

  function buildArgs(agent, message) {
    return [
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--model", model,
      "--max-turns", String(maxTurns),
      "--max-budget-usd", String(maxBudgetUsd),
      "--allowedTools", allowedTools.join(","),
      "--setting-sources", "",
      "--settings", JSON.stringify(hookSettings(hookPath, approvalHookPath)),
      ...(persona ? ["--append-system-prompt", persona] : []),
      agent.started ? "--resume" : "--session-id", agent.sessionId,
      "--",
      message,
    ];
  }

  function buildEnv(agent) {
    const env = {
      ...process.env,
      AGENT_OFFICE_AGENT_ID: agent.id,
      AGENT_OFFICE_EVENTS: eventsPath,
      AGENT_OFFICE_ADAPTER_URL: adapterUrl,
    };
    if (!allowApiKey) {
      delete env.ANTHROPIC_API_KEY;
      delete env.ANTHROPIC_AUTH_TOKEN;
    }
    return env;
  }

  /** Returns { ok: true } or { ok: false, code, message }. */
  function send({ agentId, message, runId }) {
    const agent = state.agents.get(agentId);
    if (!agent || !agent.managed) {
      return { ok: false, code: "not_controllable", message: "This avatar is an observed session. Create a runner avatar with Add to give it work." };
    }
    if (running.has(agentId)) {
      return { ok: false, code: "busy", message: "This avatar is still working on the previous instruction." };
    }
    const text = String(message || "").trim();
    if (!text) return { ok: false, code: "empty", message: "Message is empty." };

    agent.nextRunId = runId;
    agent.history.push({ role: "user", content: text });
    agent.updatedAt = Date.now();

    const child = spawn(claudeBin, buildArgs(agent, text), {
      cwd: workdir,
      env: buildEnv(agent),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const run = { child, runId, aborted: false };
    running.set(agentId, run);
    log(`[runner] ${agent.name}: started (run ${runId})`);

    let buffer = "";
    let partial = "";
    let gotResult = false;
    let stderrTail = "";

    const emit = (chatState, extra) => broadcast(chatEvent(agentId, runId, chatState, extra));

    const handleLine = (line) => {
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        return;
      }
      if (o.type === "system" && o.subtype === "init") {
        agent.started = true;
        return;
      }
      if (o.type === "stream_event") {
        const ev = o.event || {};
        if (ev.type === "message_start") partial = "";
        if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
          partial += ev.delta.text;
          emit("delta", { message: { role: "assistant", content: partial } });
        }
        return;
      }
      if (o.type === "result") {
        gotResult = true;
        agent.started = true;
        // The process can linger after its result; free the avatar right away so
        // the UI can send the next instruction without a spurious "busy".
        if (running.get(agentId) === run) running.delete(agentId);
        // A resumed session reports the whole session's spend, so keep the latest
        // value instead of summing (client-side estimate, not billing data).
        if (typeof o.total_cost_usd === "number") agent.totalCostUsd = o.total_cost_usd;
        const text = typeof o.result === "string" ? o.result : "";
        if (o.is_error) {
          emit("error", { errorMessage: text || o.subtype || "claude reported an error", message: { role: "assistant", content: text || o.subtype || "error" } });
        } else {
          agent.history.push({ role: "assistant", content: text });
          emit("final", { stopReason: "end_turn", message: { role: "assistant", content: text } });
        }
        log(`[runner] ${agent.name}: ${o.subtype} (turns ${o.num_turns}, est. $${(o.total_cost_usd ?? 0).toFixed(4)})`);
      }
    };

    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) handleLine(line);
    });
    child.stderr.on("data", (chunk) => {
      stderrTail = (stderrTail + chunk.toString("utf8")).slice(-600);
    });
    child.on("error", (err) => {
      if (running.get(agentId) === run) running.delete(agentId);
      emit("error", { errorMessage: `Failed to start claude: ${err.message}`, message: { role: "assistant", content: `Failed to start claude: ${err.message}` } });
    });
    child.on("close", (code) => {
      if (buffer.trim()) handleLine(buffer);
      if (running.get(agentId) === run) running.delete(agentId);
      if (run.aborted) {
        emit("aborted", {});
      } else if (!gotResult) {
        const detail = stderrTail.trim() || `exit code ${code}`;
        emit("error", { errorMessage: `claude exited without a result: ${detail}`, message: { role: "assistant", content: `claude exited without a result: ${detail}` } });
      }
    });

    return { ok: true };
  }

  function abort({ agentId, runId }) {
    let aborted = 0;
    for (const [id, run] of running) {
      if ((agentId && id !== agentId) || (runId && run.runId !== runId)) continue;
      run.aborted = true;
      run.child.kill("SIGTERM");
      aborted += 1;
    }
    return aborted;
  }

  function stopAll() {
    abort({});
  }

  return { createAgent, removeAgent, send, abort, stopAll, isRunning: (id) => running.has(id), config: { workdir, model, maxBudgetUsd, maxTurns, allowedTools, allowApiKey, persona } };
}

module.exports = { createRunner, hookSettings, resolvePersona, DEFAULT_PERSONA };
