#!/usr/bin/env node
"use strict";

/**
 * Claude Code hook: read the hook JSON from stdin and append one line to
 * events.jsonl. Must never fail loudly or block Claude Code, so every error
 * path exits 0.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const eventsPath =
  process.env.AGENT_OFFICE_EVENTS || path.join(os.homedir(), ".agent-office", "events.jsonl");

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  try {
    const raw = JSON.parse(input);
    const line = {
      ts: Date.now(),
      event: raw.hook_event_name,
      session_id: raw.session_id,
      cwd: raw.cwd,
      tool_name: raw.tool_name,
      tool_input: raw.tool_input,
      tool_use_id: raw.tool_use_id,
      prompt: raw.prompt,
      message: raw.message,
      notification_type: raw.notification_type,
    };
    fs.mkdirSync(path.dirname(eventsPath), { recursive: true });
    fs.appendFileSync(eventsPath, `${JSON.stringify(line)}\n`);
  } catch {
    // swallow: observation must never break the agent
  }
  process.exit(0);
});
process.stdin.on("error", () => process.exit(0));
