#!/usr/bin/env node
"use strict";

/**
 * Turn a recorded events.jsonl (from claude-code/hook.js) into a publishable,
 * masked replay fixture.
 *
 *   node scripts/mask-events.js <events.jsonl> <out.jsonl> [name1,name2,...]
 *
 * Masking (allow-list): keeps only event type, tool NAME and relative timing.
 * Everything else is dropped or replaced:
 *   - session_id  -> s1, s2, ...
 *   - cwd         -> /work/<alias> (aliases from arg 3, else project-1, ...)
 *   - prompt      -> "[masked prompt]"
 *   - tool_input  -> {}   (paths, commands, file contents are never kept)
 *   - message     -> "Permission requested"
 *   - tool_use_id -> t1, t2, ... (stable per original id)
 * Idle gaps longer than MAX_GAP_MS are compressed so the replay stays lively.
 */

const fs = require("fs");

const MAX_GAP_MS = 6000;
const [, , inPath, outPath, aliasArg] = process.argv;

if (!inPath || !outPath) {
  console.error("usage: node scripts/mask-events.js <events.jsonl> <out.jsonl> [name1,name2,...]");
  process.exit(1);
}

const aliases = (aliasArg || "").split(",").map((s) => s.trim()).filter(Boolean);
const sessionMap = new Map();
const toolMap = new Map();

const sessionAlias = (id, ordinal) => sessionMap.get(id) ?? sessionMap.set(id, { sid: `s${ordinal}`, name: aliases[ordinal - 1] || `project-${ordinal}` }).get(id);

const events = fs
  .readFileSync(inPath, "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  })
  .filter((e) => e && e.event && e.session_id)
  .sort((a, b) => a.ts - b.ts);

if (events.length === 0) {
  console.error("no usable events found");
  process.exit(1);
}

let clock = 0;
let prevTs = events[0].ts;
const out = events.map((e) => {
  clock += Math.min(e.ts - prevTs, MAX_GAP_MS);
  prevTs = e.ts;
  const { sid, name } = sessionAlias(e.session_id, sessionMap.size + (sessionMap.has(e.session_id) ? 0 : 1));
  const masked = { t: clock, event: e.event, session_id: sid, cwd: `/work/${name}` };
  if (e.tool_name) masked.tool_name = e.tool_name;
  if (e.tool_use_id) {
    if (!toolMap.has(e.tool_use_id)) toolMap.set(e.tool_use_id, `t${toolMap.size + 1}`);
    masked.tool_use_id = toolMap.get(e.tool_use_id);
  }
  if (e.event === "PreToolUse") masked.tool_input = {};
  if (e.event === "UserPromptSubmit") masked.prompt = "[masked prompt]";
  if (e.event === "Notification") masked.message = "Permission requested";
  if (e.notification_type) masked.notification_type = e.notification_type;
  return masked;
});

fs.writeFileSync(outPath, `${out.map((o) => JSON.stringify(o)).join("\n")}\n`);
console.log(`wrote ${out.length} events, ${sessionMap.size} sessions -> ${outPath}`);
