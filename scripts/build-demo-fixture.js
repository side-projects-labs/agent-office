#!/usr/bin/env node
"use strict";

/**
 * Generates public/replay/demo.jsonl: a fully synthetic ~30s scenario with
 * three Claude Code sessions. Contains no real project data.
 *   node scripts/build-demo-fixture.js
 */

const fs = require("fs");
const path = require("path");

const out = [];
let toolSeq = 0;
const emit = (t, session, event, extra = {}) =>
  out.push({ t, event, session_id: session.id, cwd: session.cwd, ...extra });

function tool(t, session, name, durationMs, input = {}) {
  const id = `t${++toolSeq}`;
  emit(t, session, "PreToolUse", { tool_name: name, tool_use_id: id, tool_input: input });
  emit(t + durationMs, session, "PostToolUse", { tool_name: name, tool_use_id: id });
  return t + durationMs;
}

const web = { id: "s1", cwd: "/work/web-app" };
const api = { id: "s2", cwd: "/work/api-server" };
const docs = { id: "s3", cwd: "/work/docs-site" };

// web-app: a feature build with an approval pause
emit(0, web, "SessionStart");
emit(1200, web, "UserPromptSubmit", { prompt: "Add a dark mode toggle to the settings page" });
let t = tool(2000, web, "Read", 900, { file_path: "src/settings/Settings.tsx" });
t = tool(t + 400, web, "Grep", 700, { pattern: "theme" });
t = tool(t + 500, web, "Edit", 1400, { file_path: "src/settings/Settings.tsx" });
emit(t + 600, web, "Notification", { message: "Allow Bash: npm test?" });
t = tool(t + 5200, web, "Bash", 3500, { command: "npm test" });
emit(t + 700, web, "Stop");

// api-server: reviews, then writes a migration
emit(4500, api, "SessionStart");
emit(5200, api, "UserPromptSubmit", { prompt: "Review the auth middleware and fix the token expiry bug" });
let u = tool(6000, api, "Read", 800, { file_path: "src/auth/middleware.ts" });
u = tool(u + 300, api, "Read", 700, { file_path: "src/auth/token.ts" });
u = tool(u + 900, api, "Edit", 1600, { file_path: "src/auth/token.ts" });
u = tool(u + 300, api, "Bash", 4200, { command: "npm run test:auth" });
emit(u + 800, api, "Stop");

// docs-site: quick pass, finishes early, then a follow-up
emit(9000, docs, "SessionStart");
emit(9800, docs, "UserPromptSubmit", { prompt: "Update the README install steps" });
let v = tool(10500, docs, "Read", 600, { file_path: "README.md" });
v = tool(v + 400, docs, "Write", 1200, { file_path: "README.md" });
emit(v + 600, docs, "Stop");
emit(v + 9000, docs, "UserPromptSubmit", { prompt: "Add a changelog entry" });
v = tool(v + 9600, docs, "Edit", 1100, { file_path: "CHANGELOG.md" });
emit(v + 500, docs, "Stop");

// wrap up
const end = Math.max(...out.map((e) => e.t)) + 4000;
emit(end, web, "SessionEnd");
emit(end + 300, api, "SessionEnd");
emit(end + 600, docs, "SessionEnd");

out.sort((a, b) => a.t - b.t);
const dest = path.join(__dirname, "..", "public", "replay", "demo.jsonl");
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, `${out.map((o) => JSON.stringify(o)).join("\n")}\n`);
console.log(`wrote ${out.length} events (${Math.round(end / 1000)}s) -> ${dest}`);
