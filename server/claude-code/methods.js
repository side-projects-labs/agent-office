"use strict";

/**
 * Gateway method handler backed by claude-code core state.
 * Environment-agnostic (no Node built-ins) so it runs in the Node adapter and
 * in the browser replay socket.
 */

const { agentPayload, sessionKeyFor, presenceFrame } = require("./core");

const MAIN_KEY = "main";
const MODELS = [{ id: "claude-code", name: "Claude Code", provider: "claude-code" }];

const resOk = (id, payload) => ({ type: "res", id, ok: true, payload: payload ?? {} });
const resErr = (id, code, message) => ({ type: "res", id, ok: false, error: { code, message } });

function createHandler(state) {
  const files = new Map();
  const sessionSettings = new Map();

  const agentForSessionKey = (key) => {
    const agentId = typeof key === "string" && key.startsWith("agent:") ? key.split(":")[1] : "";
    return state.agents.get(agentId) || null;
  };

  return async function handleMethod(method, params, id) {
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
          model: MODELS[0].id,
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

      case "status":
        return resOk(id, presenceFrame(state).payload);

      case "chat.send":
        return resErr(id, "read_only", "Claude Code adapter is observe-only; chat.send is not supported.");

      case "agents.create":
      case "agents.delete":
        return resErr(id, "read_only", "Agents mirror live Claude Code sessions and cannot be edited here.");

      case "agents.update":
        return resOk(id, { ok: true, removedBindings: 0 });

      case "chat.abort":
        return resOk(id, { ok: true, aborted: 0 });

      case "agent.wait":
        return resOk(id, { status: "done" });

      case "agents.files.get": {
        const content = files.get(`${p.agentId || ""}/${p.name || ""}`);
        return resOk(id, { file: content !== undefined ? { content } : { missing: true } });
      }

      case "agents.files.set":
        files.set(`${p.agentId || ""}/${p.name || ""}`, typeof p.content === "string" ? p.content : "");
        return resOk(id, {});

      case "sessions.patch": {
        const key = typeof p.key === "string" ? p.key : "";
        const next = { ...(sessionSettings.get(key) || {}) };
        if (p.model !== undefined) next.model = p.model;
        if (p.thinkingLevel !== undefined) next.thinkingLevel = p.thinkingLevel;
        sessionSettings.set(key, next);
        return resOk(id, {
          ok: true,
          key,
          entry: { thinkingLevel: next.thinkingLevel },
          resolved: { model: next.model || MODELS[0].id, modelProvider: "claude-code" },
        });
      }

      case "sessions.reset":
        return resOk(id, { ok: true });

      case "config.get":
        return resOk(id, {
          config: { gateway: { reload: { mode: "hot" } } },
          hash: "claude-code",
          exists: true,
          path: "/claude-code/config.json",
        });

      case "config.patch":
      case "config.set":
        return resOk(id, { hash: "claude-code" });

      case "exec.approvals.get":
        return resOk(id, {
          path: "",
          exists: true,
          hash: "claude-code-approvals",
          file: { version: 1, defaults: { security: "full", ask: "off", autoAllowSkills: true }, agents: {} },
        });

      case "exec.approvals.set":
        return resOk(id, { hash: "claude-code-approvals" });

      case "exec.approval.resolve":
        return resOk(id, { ok: true });

      case "models.list":
        return resOk(id, { models: MODELS });

      case "skills.status":
        return resOk(id, { skills: [] });

      case "cron.list":
        return resOk(id, { jobs: [] });

      case "cron.add":
      case "cron.run":
      case "cron.remove":
        return resErr(id, "unsupported_method", `Claude Code adapter does not support ${method}.`);

      case "wake":
        return resOk(id, { ok: true });

      default:
        return resOk(id, {});
    }
  };
}

const METHODS = [
  "agents.list", "agents.update", "sessions.list", "sessions.preview", "sessions.patch", "sessions.reset",
  "chat.send", "chat.abort", "chat.history", "agent.wait", "status", "config.get", "config.set",
  "config.patch", "agents.files.get", "agents.files.set", "exec.approvals.get", "exec.approvals.set",
  "exec.approval.resolve", "wake", "skills.status", "models.list", "cron.list",
];

function buildHello(state, { readOnly = true } = {}) {
  const agents = [...state.agents.values()];
  return {
    type: "hello-ok",
    protocol: 3,
    // The UI only knows demo/openclaw/hermes today; reuse "demo" until a
    // dedicated adapter type is added to the frontend.
    adapterType: "demo",
    features: {
      methods: METHODS,
      readOnly,
      // The runner only supports one-shot decisions; the UI hides "Always allow".
      approvalDecisions: ["allow-once", "deny"],
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

module.exports = { createHandler, buildHello, resOk, resErr };
