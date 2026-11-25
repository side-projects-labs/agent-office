"use strict";

/**
 * Claude Code gateway adapter (read-only observer).
 * Tails events.jsonl written by claude-code/hook.js, translates hook events to
 * Claw3D gateway frames (claude-code/core.js), and serves them over the same
 * WebSocket protocol as demo-gateway-adapter.js (claude-code/methods.js).
 */

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { randomUUID } = require("crypto");
const { WebSocketServer } = require("ws");

const { createState, applyHookEvent } = require("./claude-code/core");
const { createHandler, buildHello, resErr } = require("./claude-code/methods");

const PORT = parseInt(process.env.CLAUDE_ADAPTER_PORT || process.env.DEMO_ADAPTER_PORT || "18789", 10);
const EVENTS_PATH =
  process.env.AGENT_OFFICE_EVENTS || path.join(os.homedir(), ".agent-office", "events.jsonl");
const POLL_MS = 300;

const state = createState();
const handleMethod = createHandler(state);
const clients = new Set();

const randomId = () => randomUUID().replace(/-/g, "");

function broadcast(frame) {
  for (const send of clients) {
    try {
      send(frame);
    } catch {}
  }
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
      const lines = (carry + buf.toString("utf8")).split("\n");
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
        send({ type: "res", id, ok: true, payload: buildHello(state) });
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
    console.log(`[claude-code-adapter] ws://localhost:${PORT} (observe-only)`);
    console.log(`[claude-code-adapter] tailing ${EVENTS_PATH}`);
  });
}

if (require.main === module) startAdapter();

module.exports = { startAdapter, ingestLine, state };
