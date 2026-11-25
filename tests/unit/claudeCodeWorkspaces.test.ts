import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Avatar, Frame, Workspace } from "../helpers/claudeCodeTypes";

const require = createRequire(import.meta.url);
const { createState } = require("../../server/claude-code/core.js");
const { createRunner, composePersona, parseIdentity, DEFAULT_PERSONA } = require("../../server/claude-code/runner.js");
const { loadConfig } = require("../../server/claude-code/config.js");
const { createProfileStore } = require("../../server/claude-code/store.js");

const fake = path.resolve(__dirname, "../fixtures/fake-claude.js");
const waitFor = async (pred: () => boolean, ms = 10000) => {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
};

let root: string;
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ws-")));
});
afterEach(() => {
  delete process.env.FAKE_CLAUDE_LOG;
  fs.rmSync(root, { recursive: true, force: true });
});

const mkdir = (name: string) => {
  const p = path.join(root, name);
  fs.mkdirSync(p);
  return p;
};

describe("loadConfig", () => {
  it("reads workspaces from the config file and AGENT_OFFICE_WORKDIR, expands ~, validates", () => {
    const web = mkdir("web");
    const api = mkdir("api");
    const cfg = path.join(root, "config.json");
    fs.writeFileSync(
      cfg,
      JSON.stringify({
        workspaces: [
          { id: "web", label: "Web App", path: web },
          { id: "api", path: api },
          { id: "BAD ID", path: api },
          { id: "missing", path: path.join(root, "nope") },
          { id: "web", path: api },
        ],
        defaultWorkspace: "api",
      }),
    );
    const out = loadConfig({ env: { AGENT_OFFICE_CONFIG: cfg, AGENT_OFFICE_WORKDIR: root }, home: root });
    expect(out.workspaces.map((w: Workspace) => w.id)).toEqual(["web", "api", "default"]);
    expect(out.workspaces[0].label).toBe("Web App");
    expect(out.workspaces[1].label).toBe("api");
    expect(out.defaultWorkspaceId).toBe("api");
    expect(out.warnings.join("\n")).toMatch(/invalid workspace id/);
    expect(out.warnings.join("\n")).toMatch(/not a directory/);
    expect(out.warnings.join("\n")).toMatch(/duplicate workspace id/);
  });

  it("is empty (runner off) without any configuration, and expands ~", () => {
    const out = loadConfig({ env: { AGENT_OFFICE_CONFIG: path.join(root, "none.json") }, home: root });
    expect(out.workspaces).toEqual([]);
    mkdir("proj");
    const withHome = loadConfig({ env: { AGENT_OFFICE_WORKDIR: "~/proj" }, home: root });
    expect(withHome.workspaces[0].path).toBe(path.join(root, "proj"));
  });
});

describe("composePersona", () => {
  it("combines the base persona, identity and wizard files, and skips empty ones", () => {
    const agent: Pick<Avatar, "name" | "role" | "files"> = {
      name: "리서처",
      role: "Claude Code",
      files: {
        "IDENTITY.md": "# IDENTITY.md\n\n- Name: 리서처\n- Creature: 자료 조사 담당\n- Vibe: 차분함\n- Emoji: \n- Avatar: data:image/png;base64,AAAA\n",
        "SOUL.md": "항상 근거를 먼저 밝힌다.",
        "AGENTS.md": "   ",
        "USER.md": "사용자는 한국어를 쓴다.",
        "MEMORY.md": "should not be included",
      },
    };
    const text = composePersona(DEFAULT_PERSONA, agent);
    expect(text.startsWith(DEFAULT_PERSONA)).toBe(true);
    expect(text).toContain('이름은 "리서처"');
    expect(text).toContain('역할은 "자료 조사 담당"');
    expect(text).toContain("성격과 말투: 차분함");
    expect(text).toContain("## SOUL.md\n항상 근거를 먼저 밝힌다.");
    expect(text).toContain("## USER.md");
    expect(text).not.toContain("## AGENTS.md");
    expect(text).not.toContain("MEMORY.md");
    expect(text).not.toContain("base64");
  });

  it("works without a base persona and parses identity lines", () => {
    expect(composePersona("", { name: "A", files: {} })).toBe('이 사무실에서 당신의 이름은 "A"입니다.');
    expect(parseIdentity("- Name: A\n- Creature: \n- Vibe: v")).toEqual({ name: "A", vibe: "v" });
  });
});

describe("runner workspaces and persistence", () => {
  const make = (workspaces: Workspace[], file: string, state = createState(), frames: Frame[] = []) => {
    const store = createProfileStore(file);
    const runner = createRunner({
      state,
      broadcast: (f: Frame) => frames.push(f),
      workspaces,
      store,
      eventsPath: path.join(root, "events.jsonl"),
      adapterUrl: "http://127.0.0.1:1",
      claudeBin: fake,
    });
    return { runner, store, state, frames };
  };

  it("runs each avatar in its own workspace and rejects unknown workspace ids", async () => {
    const a = mkdir("a");
    const b = mkdir("b");
    const log = path.join(root, "fake.log");
    process.env.FAKE_CLAUDE_LOG = log;
    const { runner, frames } = make([{ id: "a", label: "a", path: a }, { id: "b", label: "b", path: b }], path.join(root, "agents.json"));
    const one = runner.createAgent({ name: "One", workspaceId: "a" });
    const two = runner.createAgent({ name: "Two", workspaceId: "b" });
    const def = runner.createAgent({ name: "Def" });
    expect(() => runner.createAgent({ name: "X", workspaceId: "../etc" })).toThrow(/Unknown workspace/);

    for (const [i, ag] of [one, two, def].entries()) runner.send({ agentId: ag.id, message: "hi", runId: `r${i}` });
    await waitFor(() => frames.filter((f) => f.event === "chat" && f.payload.state === "final").length === 3);
    const cwds = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)).map((c) => fs.realpathSync(c.cwd));
    expect(cwds.sort()).toEqual([fs.realpathSync(a), fs.realpathSync(b), fs.realpathSync(a)].sort());
    runner.stopAll();
  });

  it("stores wizard files, derives the role from IDENTITY.md, and passes the persona to claude", async () => {
    const a = mkdir("a");
    const log = path.join(root, "fake.log");
    process.env.FAKE_CLAUDE_LOG = log;
    const { runner, frames, state } = make([{ id: "a", label: "a", path: a }], path.join(root, "agents.json"));
    const ag = runner.createAgent({ name: "Helper" });
    expect(runner.setFile(ag.id, "IDENTITY.md", "- Name: Helper\n- Creature: 리뷰어\n")).toBe(true);
    expect(runner.setFile(ag.id, "SOUL.md", "꼼꼼하게 본다.")).toBe(true);
    expect(runner.setFile(ag.id, "../evil", "x")).toBe(false);
    expect(runner.setFile("nope", "SOUL.md", "x")).toBe(false);
    expect(state.agents.get(ag.id).role).toBe("리뷰어");
    expect(runner.getFile(ag.id, "SOUL.md")).toBe("꼼꼼하게 본다.");
    expect(runner.getFile(ag.id, "USER.md")).toBeUndefined();

    runner.send({ agentId: ag.id, message: "hi", runId: "r" });
    await waitFor(() => frames.some((f) => f.event === "chat" && f.payload.state === "final"));
    const call = JSON.parse(fs.readFileSync(log, "utf8").trim().split("\n")[0]);
    const prompt = call.args[call.args.indexOf("--append-system-prompt") + 1];
    expect(prompt).toContain('역할은 "리뷰어"');
    expect(prompt).toContain("꼼꼼하게 본다.");
    runner.stopAll();
  });

  it("restores avatars with files and session after a restart, keeping resume working", async () => {
    const a = mkdir("a");
    const file = path.join(root, "agents.json");
    const log = path.join(root, "fake.log");
    process.env.FAKE_CLAUDE_LOG = log;
    const first = make([{ id: "a", label: "a", path: a }], file);
    const ag = first.runner.createAgent({ name: "Keeper" });
    first.runner.setFile(ag.id, "SOUL.md", "기억한다.");
    first.runner.send({ agentId: ag.id, message: "hi", runId: "r1" });
    await waitFor(() => first.frames.some((f: Frame) => f.event === "chat" && f.payload.state === "final"));
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(saved.agents[0]).toMatchObject({ id: ag.id, name: "Keeper", workspaceId: "a", started: true, sessionId: ag.sessionId });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);

    const second = make([{ id: "a", label: "a", path: a }], file);
    expect(second.runner.restore(second.store.load())).toBe(1);
    const back = second.state.agents.get(ag.id);
    expect(back).toMatchObject({ name: "Keeper", managed: true, started: true, workspace: a });
    expect(back.files["SOUL.md"]).toBe("기억한다.");

    second.runner.send({ agentId: ag.id, message: "again", runId: "r2" });
    await waitFor(() => second.frames.some((f: Frame) => f.event === "chat" && f.payload.state === "final"));
    const calls = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(calls[1].args).toContain("--resume");
    expect(calls[1].args[calls[1].args.indexOf("--resume") + 1]).toBe(ag.sessionId);
    first.runner.stopAll();
    second.runner.stopAll();
  });

  it("keeps avatars whose workspace disappeared instead of dropping them, and handles rename/delete", () => {
    const a = mkdir("a");
    const file = path.join(root, "agents.json");
    const first = make([{ id: "a", label: "a", path: a }], file);
    const keep = first.runner.createAgent({ name: "Keep" });
    const gone = first.runner.createAgent({ name: "Gone" });
    first.runner.removeAgent(gone.id);
    expect(first.runner.renameAgent(keep.id, "Kept")).toBe(true);
    expect(first.runner.renameAgent("nope", "x")).toBe(false);

    // restart with a different set of workspaces: "a" is no longer configured
    const b = mkdir("b");
    const second = make([{ id: "b", label: "b", path: b }], file);
    expect(second.runner.restore(second.store.load())).toBe(0);
    second.runner.createAgent({ name: "New" }); // triggers a save
    const saved = JSON.parse(fs.readFileSync(file, "utf8")).agents.map((x: { name: string }) => x.name).sort();
    expect(saved).toEqual(["Kept", "New"]);
  });
});
