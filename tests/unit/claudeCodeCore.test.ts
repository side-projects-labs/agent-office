import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import type { Frame } from "../helpers/claudeCodeTypes";

const require = createRequire(import.meta.url);
const { createState, applyHookEvent, agentIdFor } = require("../../server/claude-code/core.js");

const base = { session_id: "abcd1234-xxxx", cwd: "/work/my-app" };

describe("claude-code core", () => {
  it("creates an agent named after the cwd on first event", () => {
    const state = createState();
    const { agentsChanged, frames } = applyHookEvent(state, { ...base, event: "SessionStart", ts: 1 });
    expect(agentsChanged).toBe(true);
    expect(state.agents.get(agentIdFor("abcd1234-xxxx")).name).toBe("my-app");
    expect(frames.at(-1).event).toBe("presence");
  });

  it("walks prompt -> tool -> stop through lifecycle and chat frames", () => {
    const state = createState();
    const run = (event: string, extra = {}, ts = 1) => applyHookEvent(state, { ...base, event, ts, ...extra }).frames;

    const start = run("UserPromptSubmit", { prompt: "hi" });
    expect(start.some((f: Frame) => f.payload.stream === "lifecycle" && f.payload.data?.phase === "start")).toBe(true);

    const pre = run("PreToolUse", { tool_name: "Bash", tool_input: { command: "ls" }, tool_use_id: "t1" });
    expect(pre[0].payload.stream).toBe("tool");
    expect(pre[0].payload.data?.phase).toBe("start");

    const stop = run("Stop");
    expect(stop.map((f: Frame) => f.event)).toEqual(["chat", "agent"]);
    expect(state.agents.get(agentIdFor("abcd1234-xxxx")).runId).toBeNull();
  });

  it("emits approval requested then resolved on next activity", () => {
    const state = createState();
    applyHookEvent(state, { ...base, event: "UserPromptSubmit", ts: 1 });
    const req = applyHookEvent(state, { ...base, event: "Notification", message: "Allow Bash?", ts: 2 }).frames;
    expect(req[0].event).toBe("exec.approval.requested");
    const next = applyHookEvent(state, { ...base, event: "PostToolUse", tool_name: "Bash", ts: 3 }).frames;
    expect(next[0].event).toBe("exec.approval.resolved");
  });

  it("ignores idle_prompt notifications and truncates long tool args", () => {
    const state = createState();
    expect(
      applyHookEvent(state, { ...base, event: "Notification", notification_type: "idle_prompt", ts: 1 }).frames.length,
    ).toBe(1); // only the presence frame from agent creation
    const long = "x".repeat(500);
    const frames = applyHookEvent(state, { ...base, event: "PreToolUse", tool_name: "Write", tool_input: { content: long }, ts: 2 }).frames;
    const tool = frames.find((f: Frame) => f.payload?.stream === "tool");
    expect(String(tool?.payload.data?.arguments?.content).length).toBeLessThan(300);
  });

  it("removes the agent on SessionEnd", () => {
    const state = createState();
    applyHookEvent(state, { ...base, event: "SessionStart", ts: 1 });
    applyHookEvent(state, { ...base, event: "SessionEnd", ts: 2 });
    expect(state.agents.size).toBe(0);
  });
});
