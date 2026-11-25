"use strict";

/**
 * Claude Code gateway adapter (read-only observer).
 * Tails events.jsonl written by claude-code/hook.js, translates hook events to
 * Claw3D gateway frames, and serves them over the same WebSocket protocol as
 * demo-gateway-adapter.js. Unrelated methods fall back to the demo handler.
 */

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { randomUUID } = require("crypto");
const { WebSocketServer } = require("ws");

const demo = require("./demo-gateway-adapter");
const { createState, applyHookEvent, agentPayload, sessionKeyFor, presenceFrame } = require("./claude-code/core");

const PORT = parseInt(process.env.CLAUDE_ADAPTER_PORT || process.env.DEMO_ADAPTER_PORT || "18789", 10);
const EVENTS_PATH =
  process.env.AGENT_OFFICE_EVENTS || path.join(os.homedir(), ".agent-office", "events.jsonl");
const POLL_MS = 300;
const MAIN_KEY = "main";

const state = createState();
const clients = new Set();

const randomId = () => randomUUID().replace(/-/g, "");
const resOk = (id, payload) => ({ type: "res", id, ok: true, payload: payload ?? {} });
const resErr = (id, code, message) => ({ type: "res", id, ok: false, error: { code, message } });

function broadcast(frame) {
  for (const send of clients) {
    try {
      send(frame);
    } catch {}
  }
}

function agentForSessionKey(key) {
  const agentId = typeof key === "string" && key.startsWith("agent:") ? key.split(":")[1] : "";
  return state.agents.get(agentId) || null;
}

async function handleMethod(method, params, id, sendEvent) {
  const p = params || {};
  switch (method) {
    case "agents.list": {
      const agents = [...state.agents.values()].map(agentPayload);
      return resOk(id, { defaultId: agents[0]?.id ?? "", mainKey: MAIN_KEY, agents });
    }

    case "sessions.list": {
      const sessions = [...state.agents.values()].map((a) => ({
        key: sessionKeyFor(a.id),
        agentId: a.id,
        updatedAt: a.updatedAt,
        displayName: "Main",
        origin: { label: a.name, provider: "claude-code" },
        model: "claude-code",
        modelProvider: "claude-code",
      }));
      return resOk(id, { sessions });
    }

    case "sessions.preview": {
      const keys = Array.isArray(p.keys) ? p.keys : [];
      const limit = typeof p.limit === "number" ? p.limit : 8;
      const maxChars = typeof p.maxChars === "number" ? p.maxChars : 240;
      const previews = keys.map((key) => {
        const agent = agentForSessionKey(key);
        if (!agent || agent.history.length === 0) return { key, status: "empty", items: [] };
        return {
          key,
          status: "ok",
          items: agent.history.slice(-limit).map((m) => ({
            role: m.role,
            text: String(m.content || "").slice(0, maxChars),
            timestamp: Date.now(),
          })),
        };
      });
      return resOk(id, { ts: Date.now(), previews });
    }

    case "chat.history": {
      const agent = agentForSessionKey(p.sessionKey);
      return resOk(id, { sessionKey: p.sessionKey, messages: agent ? agent.history : [] });
    }

    case "status": {
      const frame = presenceFrame(state);
      return resOk(id, frame.payload);
    }

    case "chat.send":
      return resErr(id, "read_only", "Claude Code adapter is observe-only; chat.send is not supported.");

    case "agents.create":
    case "agents.delete":
      return resErr(id, "read_only", "Agents mirror live Claude Code sessions and cannot be edited here.");

    case "chat.abort":
      return resOk(id, { ok: true, aborted: 0 });

    case "agent.wait":
      return resOk(id, { status: "done" });

    default:
      return demo.handleMethod(method, params, id, sendEvent);
  }
}

function helloPayload() {
  const agents = [...state.agents.values()];
  return {
    type: "hello-ok",
    protocol: 3,
    // The UI only knows demo/openclaw/hermes today; reuse "demo" until a
    // dedicated adapter type is added to the frontend.
    adapterType: "demo",
    features: {
      methods: [
        "agents.list", "sessions.list", "sessions.preview", "sessions.patch", "sessions.reset",
        "chat.send", "chat.abort", "chat.history", "agent.wait", "status", "config.get",
        "config.set", "config.patch", "agents.files.get", "agents.files.set",
        "exec.approvals.get", "exec.approvals.set", "exec.approval.resolve", "wake",
        "skills.status", "models.list", "cron.list",
      ],
      events: ["chat", "presence", "heartbeat", "agent", "exec.approval.requested", "exec.approval.resolved"],
    },
    snapshot: {
      health: {
        agents: agents.map((a) => ({ agentId: a.id, name: a.name, isDefault: false })),
        defaultAgentId: agents[0]?.id ?? "",
      },
      sessionDefaults: { mainKey: MAIN_KEY },
    },
    auth: { role: "operator", scopes: ["operator.admin"] },
    policy: { tickIntervalMs: 30000 },
  };
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
  fs.mkdirSync(path.dirname(EVENTS_PATH), { recursive: true });
  if (!fs.existsSync(EVENTS_PATH)) fs.writeFileSync(EVENTS_PATH, "");
  let offset = fs.statSync(EVENTS_PATH).size; // live mode: start at end
  let carry = "";

  const timer = setInterval(() => {
    let size;
    try {
      size = fs.statSync(EVENTS_PATH).size;
    } catch {
      return;
    }
    if (size < offset) offset = 0; // truncated/rotated
    if (size === offset) return;
    const fd = fs.openSync(EVENTS_PATH, "r");
    try {
      const buf = Buffer.alloc(size - offset);
      fs.readSync(fd, buf, 0, buf.length, offset);
      offset = size;
      const text = carry + buf.toString("utf8");
      const lines = text.split("\n");
      carry = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) ingestLine(line);
    } finally {
      fs.closeSync(fd);
    }
  }, POLL_MS);
  timer.unref?.();
  return timer;
}

function startAdapter() {
  const httpServer = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Claw3D Claude Code Gateway Adapter (observe-only)\n");
  });
  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (ws) => {
    let connected = false;
    let globalSeq = 0;
    const send = (frame) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
    };
    const sendEvent = (frame) => {
      if (frame.type === "event" && typeof frame.seq !== "number") frame.seq = globalSeq++;
      send(frame);
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
        send({ type: "res", id, ok: true, payload: helloPayload() });
        return;
      }
      if (!connected) return send(resErr(id, "not_connected", "Send connect first."));
      try {
        send(await handleMethod(method, params, id, sendEvent));
      } catch (error) {
        send(resErr(id, "internal_error", error instanceof Error ? error.message : "Internal error"));
      }
    });
    ws.on("close", () => clients.delete(sendEvent));
    ws.on("error", () => clients.delete(sendEvent));
  });

  startTail();
  httpServer.listen(PORT, "127.0.0.1", () => {
    console.log(`[claude-code-adapter] ws://localhost:${PORT} (observe-only)`);
    console.log(`[claude-code-adapter] tailing ${EVENTS_PATH}`);
  });
}

if (require.main === module) startAdapter();

module.exports = { startAdapter, handleMethod, ingestLine, state };
