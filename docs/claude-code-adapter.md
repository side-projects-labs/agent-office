# Claude Code adapter

Shows live Claude Code sessions as agents in the 3D office.

- **Observe mode (default)**: read-only. Your own Claude Code sessions appear as
  avatars; the UI cannot send prompts to them.
- **Runner mode (opt-in, local only)**: avatars you create with **Add** run work via
  `claude -p --output-format stream-json`, and permission requests are answered
  from the UI. See "Runner mode" below.

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
- Observed sessions: approvals are display-only (they auto-clear on the next activity).
- Tool arguments are truncated to 200 chars but not otherwise masked. Do not
  publish recorded `events.jsonl` files without masking.

## Runner mode (local only)

Never available on the deployed replay site: it needs the `claude` CLI and your
login on the machine that runs the adapter.

```bash
AGENT_OFFICE_WORKDIR=/path/to/a/project npm run claude-adapter
npm run dev
```

- Runner avatars are created from the UI (**Add**). Each instruction spawns one
  `claude -p` process in `AGENT_OFFICE_WORKDIR`; follow-ups resume the same
  session (`--session-id` first, then `--resume`).
- Your own interactive sessions are never controlled; sending to them is rejected.
- **Permissions**: `Read`, `Glob`, `Grep` run automatically. Everything else
  (`Write`, `Edit`, `Bash`, ...) is sent to the UI as an approval card; Allow
  runs it, Deny blocks it. Unanswered requests are denied after 9 minutes.
- **Hooks**: injected per process with `--settings` (and `--setting-sources ""`),
  so your own Claude Code settings are untouched and not loaded by runner runs.
- **Billing**: runs use your Claude login (subscription quota). `ANTHROPIC_API_KEY`
  and `ANTHROPIC_AUTH_TOKEN` are removed from the child environment so a stray
  key cannot silently switch to API billing. Set `AGENT_OFFICE_ALLOW_API_KEY=1`
  to allow it. Whether using a subscription this way is permitted for your use
  is your responsibility to check against Anthropic's terms; do not expose the
  adapter to other people.
- **Persona**: every run appends a persona via `--append-system-prompt`. The default
  answers in Korean (polite, concise) while leaving code, commands, paths,
  identifiers, error text and code comments untranslated. Override with
  `AGENT_OFFICE_PERSONA="..."` or turn it off with `AGENT_OFFICE_PERSONA=off`.
- The adapter only listens on `127.0.0.1`.

| Variable | Default |
|---|---|
| `AGENT_OFFICE_WORKDIR` | unset (runner off) |
| `AGENT_OFFICE_MODEL` | `claude-sonnet-5-5` |
| `AGENT_OFFICE_MAX_TURNS` | `20` |
| `AGENT_OFFICE_MAX_BUDGET_USD` | `1` (per run, client-side estimate) |
| `AGENT_OFFICE_CLAUDE_BIN` | `claude` |
| `AGENT_OFFICE_ALLOW_API_KEY` | unset |
| `AGENT_OFFICE_PERSONA` | built-in Korean persona; custom text replaces it, `off` disables it |
