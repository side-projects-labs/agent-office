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

const PERSONA_FILES = ["SOUL.md", "AGENTS.md", "USER.md"];
const MAX_FILE_CHARS = 4000;
const MAX_STORED_FILE_CHARS = 100_000;
const FILE_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

const truncate = (text, max) => (text.length > max ? `${text.slice(0, max)}\n…(truncated)` : text);

/** Non-empty "- Key: value" lines of the wizard's IDENTITY.md (Avatar is skipped: it can be large). */
function parseIdentity(markdown) {
  const out = {};
  for (const line of String(markdown || "").split("\n")) {
    const m = line.match(/^\s*-\s*(Name|Creature|Vibe|Emoji):\s*(.*)$/i);
    if (m && m[2].trim()) out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}

/**
 * System prompt for one avatar: the base persona (language/code rules), who the
 * avatar is, and the persona files written in the Add wizard.
 */
function composePersona(basePersona, agent) {
  const parts = [];
  if (basePersona) parts.push(basePersona);
  const identity = parseIdentity(agent.files?.["IDENTITY.md"]);
  const who = [`이 사무실에서 당신의 이름은 "${agent.name}"입니다.`];
  const role = identity.creature || (agent.role && agent.role !== "Claude Code" ? agent.role : "");
  if (role) who.push(`당신의 역할은 "${role}"입니다.`);
  if (identity.vibe) who.push(`성격과 말투: ${identity.vibe}`);
  parts.push(who.join(" "));
  for (const name of PERSONA_FILES) {
    const content = String(agent.files?.[name] || "").trim();
    if (content) parts.push(`## ${name}\n${truncate(content, MAX_FILE_CHARS)}`);
  }
  return parts.join("\n\n");
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
    workspaces = [],
    defaultWorkspaceId = workspaces[0]?.id ?? null,
    store = null,
    eventsPath,
    adapterUrl,
    claudeBin = process.env.AGENT_OFFICE_CLAUDE_BIN || "claude",
    model = process.env.AGENT_OFFICE_MODEL || "claude-sonnet-5-5",
    maxBudgetUsd = Number(process.env.AGENT_OFFICE_MAX_BUDGET_USD || 1),
    maxTurns = Number(process.env.AGENT_OFFICE_MAX_TURNS || 20),
    // Empty on purpose: a bare tool name in --allowedTools approves that tool for ANY path,
    // which let avatars read files outside their workspace. Without it, Claude Code runs
    // reads inside the working directory unprompted and asks (-> UI) for everything else.
    allowedTools = [],
    allowApiKey = process.env.AGENT_OFFICE_ALLOW_API_KEY === "1",
    persona = resolvePersona(process.env.AGENT_OFFICE_PERSONA),
    log = () => {},
  } = options;

  const hookPath = path.join(__dirname, "hook.js");
  const approvalHookPath = path.join(__dirname, "approval-hook.js");
  const running = new Map(); // agentId -> { child, runId, aborted }

  const orphans = []; // stored profiles whose workspace is gone; kept untouched

  const serialize = (a) => ({
    id: a.id,
    name: a.name,
    role: a.role,
    workspaceId: a.workspaceId,
    sessionId: a.sessionId,
    started: a.started,
    files: a.files,
    totalCostUsd: a.totalCostUsd,
  });

  function persist() {
    if (!store) return;
    try {
      store.save([...[...state.agents.values()].filter((a) => a.managed).map(serialize), ...orphans]);
    } catch (err) {
      log(`[runner] could not save avatars: ${err.message}`);
    }
  }

  /** Restore saved avatars; ones whose workspace no longer exists are kept aside. */
  function restore(profiles) {
    let restored = 0;
    for (const p of profiles) {
      const ws = workspaces.find((w) => w.id === p.workspaceId);
      if (!ws) {
        orphans.push(p);
        log(`[runner] "${p.name}" needs workspace "${p.workspaceId}" which is not configured; skipped`);
        continue;
      }
      createManagedAgent(state, { ...p, workspace: ws.path });
      restored += 1;
    }
    return restored;
  }

  function createAgent({ name, role, workspaceId }) {
    const label = String(name || "").trim() || "Claude";
    const wsId = workspaceId || defaultWorkspaceId;
    const ws = workspaces.find((w) => w.id === wsId);
    if (!ws) {
      const err = new Error(`Unknown workspace "${wsId}".`);
      err.code = "unknown_workspace";
      throw err;
    }
    const id = `run-${slugify(label)}-${randomUUID().slice(0, 6)}`;
    const agent = createManagedAgent(state, {
      id,
      name: label,
      role,
      workspace: ws.path,
      workspaceId: ws.id,
      sessionId: randomUUID(),
    });
    persist();
    broadcast(presenceFrame(state));
    return agent;
  }

  function removeAgent(agentId) {
    abort({ agentId });
    const removed = state.agents.delete(agentId);
    if (removed) {
      persist();
      broadcast(presenceFrame(state));
    }
    return removed;
  }

  function renameAgent(agentId, name) {
    const agent = state.agents.get(agentId);
    const label = String(name || "").trim();
    if (!agent || !agent.managed || !label) return false;
    agent.name = label;
    persist();
    broadcast(presenceFrame(state));
    return true;
  }

  /** Persona files from the wizard. Returns false if the avatar is not a runner avatar. */
  function setFile(agentId, fileName, content) {
    const agent = state.agents.get(agentId);
    if (!agent || !agent.managed) return false;
    if (!FILE_NAME_PATTERN.test(String(fileName))) return false;
    agent.files[fileName] = truncate(String(content ?? ""), MAX_STORED_FILE_CHARS);
    if (fileName === "IDENTITY.md") {
      const { creature } = parseIdentity(agent.files[fileName]);
      if (creature) agent.role = creature;
    }
    persist();
    broadcast(presenceFrame(state));
    return true;
  }

  function getFile(agentId, fileName) {
    const agent = state.agents.get(agentId);
    if (!agent || !agent.managed) return undefined;
    return agent.files[fileName];
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
      ...(allowedTools.length > 0 ? ["--allowedTools", allowedTools.join(",")] : []),
      "--setting-sources", "",
      "--settings", JSON.stringify(hookSettings(hookPath, approvalHookPath)),
      "--append-system-prompt", composePersona(persona, agent),
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
      cwd: agent.workspace,
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
        if (!agent.started) {
          agent.started = true;
          persist();
        }
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
        persist();
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

  return {
    createAgent,
    removeAgent,
    renameAgent,
    setFile,
    getFile,
    restore,
    send,
    abort,
    stopAll,
    isRunning: (id) => running.has(id),
    config: { workspaces, defaultWorkspaceId, model, maxBudgetUsd, maxTurns, allowedTools, allowApiKey, persona },
  };
}

module.exports = { createRunner, hookSettings, resolvePersona, composePersona, parseIdentity, DEFAULT_PERSONA };
