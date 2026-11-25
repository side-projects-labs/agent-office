#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS test double */
// Test double for `claude -p --output-format stream-json`.
// Logs argv/env to FAKE_CLAUDE_LOG and prints a canned stream.
const fs = require("fs");
const args = process.argv.slice(2);
if (process.env.FAKE_CLAUDE_LOG) {
  fs.appendFileSync(
    process.env.FAKE_CLAUDE_LOG,
    `${JSON.stringify({ args, hasApiKey: "ANTHROPIC_API_KEY" in process.env, agentId: process.env.AGENT_OFFICE_AGENT_ID, cwd: process.cwd() })}\n`,
  );
}
const sid = args[args.indexOf("--session-id") + 1] || args[args.indexOf("--resume") + 1];
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const delay = Number(process.env.FAKE_CLAUDE_DELAY_MS || 0);
out({ type: "system", subtype: "init", session_id: sid, model: "fake" });
out({ type: "stream_event", event: { type: "message_start" } });
out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } } });
out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } } });
setTimeout(() => {
  if (process.env.FAKE_CLAUDE_FAIL) process.exit(3);
  out({ type: "result", subtype: "success", is_error: false, result: "Hello", session_id: sid, total_cost_usd: 0.01, num_turns: 1 });
}, delay);
