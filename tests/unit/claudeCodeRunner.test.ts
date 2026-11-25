import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { createState, applyHookEvent } = require("../../server/claude-code/core.js");
const { createRunner, hookSettings } = require("../../server/claude-code/runner.js");

const fake = path.resolve(__dirname, "../fixtures/fake-claude.js");

const waitFor = async (pred: () => boolean, ms = 10000) => {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe("claude-code runner", () => {
  let dir: string;
  let log: string;
  let frames: any[];
  let state: any;
  let runner: any;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "runner-"));
    log = path.join(dir, "fake.log");
    process.env.FAKE_CLAUDE_LOG = log;
    process.env.ANTHROPIC_API_KEY = "sk-test-should-be-stripped";
    delete process.env.FAKE_CLAUDE_FAIL;
    delete process.env.FAKE_CLAUDE_DELAY_MS;
    frames = [];
    state = createState();
    runner = createRunner({
      state,
      broadcast: (f: any) => frames.push(f),
      workspaces: [{ id: "default", label: "default", path: dir }],
      eventsPath: path.join(dir, "events.jsonl"),
      adapterUrl: "http://127.0.0.1:1",
      claudeBin: fake,
    });
  });

  afterEach(() => {
    runner.stopAll();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.FAKE_CLAUDE_LOG;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const chat = (s: string) => frames.filter((f) => f.event === "chat" && f.payload.state === s);

  it("streams cumulative deltas then a final, and resumes the same session on the second send", async () => {
    const agent = runner.createAgent({ name: "Builder" });
    expect(agent.managed).toBe(true);
    expect(runner.send({ agentId: agent.id, message: "hi", runId: "r1" }).ok).toBe(true);
    await waitFor(() => chat("final").length === 1);

    expect(chat("delta").map((f) => f.payload.message.content)).toEqual(["Hel", "Hello"]);
    expect(chat("final")[0].payload).toMatchObject({ runId: "r1", message: { content: "Hello" } });
    expect(agent.history.map((m: any) => m.role)).toEqual(["user", "assistant"]);

    runner.send({ agentId: agent.id, message: "again", runId: "r2" });
    await waitFor(() => chat("final").length === 2);

    const calls = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(calls[0].args).toContain("--session-id");
    expect(calls[1].args).toContain("--resume");
    expect(calls[1].args[calls[1].args.indexOf("--resume") + 1]).toBe(agent.sessionId);
    expect(calls[0].args.slice(-2)).toEqual(["--", "hi"]);
  });

  it("strips the API key from the child env and tags hook events with the avatar", async () => {
    const agent = runner.createAgent({ name: "Builder" });
    runner.send({ agentId: agent.id, message: "x", runId: "r1" });
    await waitFor(() => chat("final").length === 1);
    const call = JSON.parse(fs.readFileSync(log, "utf8").trim().split("\n")[0]);
    expect(call.hasApiKey).toBe(false);
    expect(call.agentId).toBe(agent.id);
  });

  it("injects hooks and the model only through --settings / flags", async () => {
    const agent = runner.createAgent({ name: "Builder" });
    runner.send({ agentId: agent.id, message: "x", runId: "r1" });
    await waitFor(() => chat("final").length === 1);
    const call = JSON.parse(fs.readFileSync(log, "utf8").trim().split("\n")[0]);
    const settings = JSON.parse(call.args[call.args.indexOf("--settings") + 1]);
    expect(Object.keys(settings.hooks)).toContain("PermissionRequest");
    expect(call.args[call.args.indexOf("--setting-sources") + 1]).toBe("");
    expect(call.args[call.args.indexOf("--allowedTools") + 1]).toBe("Read,Glob,Grep");
    expect(hookSettings("/a", "/b").hooks.Stop).toBeTruthy();
  });

  it("rejects observed sessions, empty messages, and overlapping runs", async () => {
    applyHookEvent(state, { event: "SessionStart", session_id: "abcd1234", cwd: "/x", ts: 1 });
    const observed = [...state.agents.values()].find((a: any) => !a.managed);
    expect(runner.send({ agentId: observed.id, message: "hi", runId: "r" })).toMatchObject({ ok: false, code: "not_controllable" });

    const agent = runner.createAgent({ name: "Builder" });
    expect(runner.send({ agentId: agent.id, message: "  ", runId: "r" })).toMatchObject({ ok: false, code: "empty" });

    process.env.FAKE_CLAUDE_DELAY_MS = "300";
    expect(runner.send({ agentId: agent.id, message: "a", runId: "r1" }).ok).toBe(true);
    expect(runner.send({ agentId: agent.id, message: "b", runId: "r2" })).toMatchObject({ ok: false, code: "busy" });
    await waitFor(() => chat("final").length === 1);
  });

  it("emits an error when claude exits without a result, and aborted when aborted", async () => {
    const agent = runner.createAgent({ name: "Builder" });
    process.env.FAKE_CLAUDE_FAIL = "1";
    process.env.FAKE_CLAUDE_DELAY_MS = "50";
    runner.send({ agentId: agent.id, message: "x", runId: "r1" });
    await waitFor(() => chat("error").length === 1);
    expect(chat("error")[0].payload.errorMessage).toContain("exit code 3");

    delete process.env.FAKE_CLAUDE_FAIL;
    process.env.FAKE_CLAUDE_DELAY_MS = "2000";
    runner.send({ agentId: agent.id, message: "y", runId: "r2" });
    await waitFor(() => runner.isRunning(agent.id));
    expect(runner.abort({ agentId: agent.id })).toBe(1);
    await waitFor(() => chat("aborted").length === 1);
  });
});

describe("core with managed agents", () => {
  it("keeps the avatar across SessionEnd, uses the runner's runId, and leaves chat text to the runner", () => {
    const state = createState();
    const { createManagedAgent } = require("../../server/claude-code/core.js");
    const agent = createManagedAgent(state, { id: "run-a-1", name: "A", workspace: "/w", sessionId: "s1" });
    agent.nextRunId = "RUN-X";
    const ev = (event: string, extra = {}) => applyHookEvent(state, { event, session_id: "s1", office_agent_id: "run-a-1", cwd: "/w", ts: 1, ...extra }).frames;

    ev("SessionStart");
    const start = ev("UserPromptSubmit", { prompt: "secret prompt" });
    expect(start[0].payload.runId).toBe("RUN-X");
    expect(agent.history).toHaveLength(0);

    const stop = ev("Stop");
    expect(stop.map((f: any) => f.event)).toEqual(["agent"]);
    ev("SessionEnd");
    expect(state.agents.has("run-a-1")).toBe(true);
    expect(state.agents.size).toBe(1);
  });
});

describe("runner busy state", () => {
  it("accepts a new instruction as soon as the result arrives, even if the process lingers", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runner-busy-"));
    const frames: any[] = [];
    const state = createState();
    const runner = createRunner({
      state,
      broadcast: (f: any) => frames.push(f),
      workspaces: [{ id: "default", label: "default", path: dir }],
      eventsPath: path.join(dir, "events.jsonl"),
      adapterUrl: "http://127.0.0.1:1",
      claudeBin: path.resolve(__dirname, "../fixtures/fake-claude-linger.js"),
    });
    const agent = runner.createAgent({ name: "Lingerer" });
    runner.send({ agentId: agent.id, message: "one", runId: "r1" });
    await waitFor(() => frames.some((f) => f.event === "chat" && f.payload.state === "final"));
    expect(runner.send({ agentId: agent.id, message: "two", runId: "r2" }).ok).toBe(true);
    runner.stopAll();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("runner persona", () => {
  const { resolvePersona, DEFAULT_PERSONA } = require("../../server/claude-code/runner.js");

  it("defaults to the Korean persona, accepts custom text, and can be turned off", () => {
    expect(resolvePersona(undefined)).toBe(DEFAULT_PERSONA);
    expect(resolvePersona("")).toBe(DEFAULT_PERSONA);
    expect(resolvePersona("Be brief.")).toBe("Be brief.");
    expect(resolvePersona("off")).toBe("");
    expect(resolvePersona(" OFF ")).toBe("");
    expect(DEFAULT_PERSONA).toContain("한국어");
    expect(DEFAULT_PERSONA).toContain("코드");
  });

  const runWith = async (persona?: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runner-persona-"));
    const log = path.join(dir, "fake.log");
    process.env.FAKE_CLAUDE_LOG = log;
    const frames: any[] = [];
    const state = createState();
    const runner = createRunner({
      state,
      broadcast: (f: any) => frames.push(f),
      workspaces: [{ id: "default", label: "default", path: dir }],
      eventsPath: path.join(dir, "events.jsonl"),
      adapterUrl: "http://127.0.0.1:1",
      claudeBin: path.resolve(__dirname, "../fixtures/fake-claude.js"),
      ...(persona === undefined ? {} : { persona }),
    });
    const agent = runner.createAgent({ name: "P" });
    runner.send({ agentId: agent.id, message: "hi", runId: "r1" });
    await waitFor(() => frames.some((f) => f.event === "chat" && f.payload.state === "final"));
    const call = JSON.parse(fs.readFileSync(log, "utf8").trim().split("\n")[0]);
    runner.stopAll();
    delete process.env.FAKE_CLAUDE_LOG;
    fs.rmSync(dir, { recursive: true, force: true });
    return call.args as string[];
  };

  it("passes the persona on every run via --append-system-prompt; off drops only the base rules", async () => {
    const withPersona = await runWith();
    const prompt = withPersona[withPersona.indexOf("--append-system-prompt") + 1];
    expect(prompt.startsWith(DEFAULT_PERSONA)).toBe(true);
    expect(prompt).toContain('이름은 "P"');

    const off = await runWith("");
    const offPrompt = off[off.indexOf("--append-system-prompt") + 1];
    expect(offPrompt).not.toContain(DEFAULT_PERSONA);
    expect(offPrompt).toContain('이름은 "P"');
  });
});
