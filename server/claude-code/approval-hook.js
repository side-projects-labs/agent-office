#!/usr/bin/env node
"use strict";

/**
 * PermissionRequest hook for runner processes. Forwards the request to the
 * adapter, waits for the office UI's Allow/Deny, and prints the decision.
 * On any failure it prints nothing and exits 0, so Claude Code's default
 * handling applies (headless: the call is denied).
 */

const http = require("http");

const adapterUrl = process.env.AGENT_OFFICE_ADAPTER_URL;
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  if (!adapterUrl) process.exit(0);
  let raw;
  try {
    raw = JSON.parse(input);
  } catch {
    process.exit(0);
  }
  const body = JSON.stringify({
    agent_id: process.env.AGENT_OFFICE_AGENT_ID,
    tool_name: raw.tool_name,
    tool_input: raw.tool_input,
    cwd: raw.cwd,
  });
  const url = new URL("/approval", adapterUrl);
  const req = http.request(
    { hostname: url.hostname, port: url.port, path: url.pathname, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
    (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const { decision } = JSON.parse(data);
          const allow = decision === "allow-once" || decision === "allow-always";
          const out = {
            hookSpecificOutput: {
              hookEventName: "PermissionRequest",
              decision: allow ? { behavior: "allow" } : { behavior: "deny", message: "Denied from Agent Office" },
            },
          };
          process.stdout.write(JSON.stringify(out));
        } catch {
          // fall through to default handling
        }
        process.exit(0);
      });
    },
  );
  req.on("error", () => process.exit(0));
  req.write(body);
  req.end();
});
process.stdin.on("error", () => process.exit(0));
