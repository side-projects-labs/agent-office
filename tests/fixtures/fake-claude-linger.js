#!/usr/bin/env node
// Emits a result, then keeps running for a while (like a process that is slow to exit).
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
out({ type: "system", subtype: "init", session_id: "s" });
out({ type: "result", subtype: "success", is_error: false, result: "ok", session_id: "s", total_cost_usd: 0, num_turns: 1 });
setTimeout(() => process.exit(0), 3000);
