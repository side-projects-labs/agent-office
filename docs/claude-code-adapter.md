# Claude Code adapter (observe-only)

Shows live Claude Code sessions as agents in the 3D office. Read-only: the UI
cannot send prompts to or approve for Claude Code.

```text
Claude Code --hooks--> server/claude-code/hook.js --> ~/.agent-office/events.jsonl
                                                          | tail
                                           server/claude-code-adapter.js (ws://localhost:18789)
                                                          |
                                                   Studio + 3D office
```

## Run

```bash
npm run claude-adapter   # instead of npm run demo-gateway
npm run dev
```

In Studio, connect to `ws://localhost:18789`. The adapter currently reports
itself as the `demo` backend because the frontend only knows demo/openclaw/hermes.

## Register the hooks (manual, per project)

The adapter never edits your Claude Code settings. Add this to the target
project's `.claude/settings.local.json` (replace the path):

```json
{
  "hooks": {
    "SessionStart":     [{ "hooks": [{ "type": "command", "command": "node /ABS/PATH/agent-office/server/claude-code/hook.js" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node /ABS/PATH/agent-office/server/claude-code/hook.js" }] }],
    "PreToolUse":       [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node /ABS/PATH/agent-office/server/claude-code/hook.js" }] }],
    "PostToolUse":      [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node /ABS/PATH/agent-office/server/claude-code/hook.js" }] }],
    "Notification":     [{ "hooks": [{ "type": "command", "command": "node /ABS/PATH/agent-office/server/claude-code/hook.js" }] }],
    "Stop":             [{ "hooks": [{ "type": "command", "command": "node /ABS/PATH/agent-office/server/claude-code/hook.js" }] }],
    "SessionEnd":       [{ "hooks": [{ "type": "command", "command": "node /ABS/PATH/agent-office/server/claude-code/hook.js" }] }]
  }
}
```

`hook.js` always exits 0, so a failure never blocks Claude Code.

## Env

| Variable | Default |
|---|---|
| `AGENT_OFFICE_EVENTS` | `~/.agent-office/events.jsonl` |
| `CLAUDE_ADAPTER_PORT` | `18789` |

## Known gaps (v1)

- Subagents are not separate characters yet.
- No stall detection (agent-hq marks 10 min without output).
- Approvals are display-only; they auto-clear on the next activity.
- Tool arguments are truncated to 200 chars but not otherwise masked. Do not
  publish recorded `events.jsonl` files without masking.
