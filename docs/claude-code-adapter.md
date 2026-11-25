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
AGENT_OFFICE_WORKDIR=/path/to/a/project npm run claude-adapter   # one folder
npm run claude-adapter                                           # folders from config.json
npm run dev
```

### Workspaces (which folders avatars may work in)

Put the allowed folders in `~/.agent-office/config.json` (or `AGENT_OFFICE_CONFIG`):

```json
{
  "workspaces": [
    { "id": "web", "label": "web-app", "path": "~/Desktop/web-app" },
    { "id": "api", "label": "api-server", "path": "~/Desktop/api-server" }
  ],
  "defaultWorkspace": "web"
}
```

`AGENT_OFFICE_WORKDIR` is a shortcut that adds one more workspace with id `default`.
The runner is on whenever at least one valid workspace exists.

- The Add wizard shows a **Workspace** picker (first step). The UI sends only the
  workspace **id**; paths come from this file, so the UI cannot point an avatar at an
  arbitrary folder. Each `claude -p` run uses that folder as its working directory.
  The folder cannot be changed after creation: make a new avatar instead.
- Ids use lowercase letters, digits and dashes. Invalid, duplicate or missing folders
  are skipped with a warning at startup.

### Roles, personality and persistence

- The wizard writes `IDENTITY.md`, `SOUL.md`, `AGENTS.md`, `USER.md`, ... through
  `agents.files.set`. The runner stores them per avatar and, on every run, appends
  a system prompt made of: the base persona (see **Persona**), the avatar's name,
  its role (`Creature:` in `IDENTITY.md`, also shown as the role label) and vibe,
  and the contents of `SOUL.md`, `AGENTS.md` and `USER.md` (4000 chars each).
  Other files are stored but not sent. The avatar image field is never sent.
- Avatars are saved to `~/.agent-office/agents.json` (`AGENT_OFFICE_AGENTS_FILE`, mode
  600) with their files and Claude session id, so they survive restarts and keep
  their conversation (`--resume`). An avatar whose workspace is no longer configured
  is left in the file untouched and skipped until the workspace returns.
- The file holds the text you wrote in the wizard and the session ids, not
  conversation transcripts (those stay in Claude Code's own session store).

- Runner avatars are created from the UI (**Add**). Each instruction spawns one
  `claude -p` process in the avatar's workspace; follow-ups resume the same
  session (`--session-id` first, then `--resume`).
- Your own interactive sessions are never controlled; sending to them is rejected.
- **Permissions**: Claude Code's own default rules apply. Reading files inside the
  avatar's workspace and read-only shell commands there (`ls`, `cat`, `grep`, ...) run
  without asking. Everything else is sent to the UI as an approval card: writes and
  edits, other shell commands, and **any access outside the workspace** (even a
  `cat` or `ls`). Allow runs it once, Deny blocks it. Unanswered requests are denied
  after 9 minutes. There is no blanket tool allow-list: a bare `--allowedTools Read`
  would approve reads of any path, which let avatars read outside their folder.
- **Not a sandbox**: this is Claude Code's permission system, not OS isolation. A
  command you approve runs with your full user privileges, so read approval cards
  before pressing Allow. Treat the workspace as a convenience boundary, not a jail.
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
| `AGENT_OFFICE_WORKDIR` | unset; adds workspace `default` |
| `AGENT_OFFICE_CONFIG` | `~/.agent-office/config.json` |
| `AGENT_OFFICE_AGENTS_FILE` | `~/.agent-office/agents.json` |
| `AGENT_OFFICE_MODEL` | `claude-sonnet-5-5` |
| `AGENT_OFFICE_MAX_TURNS` | `20` |
| `AGENT_OFFICE_MAX_BUDGET_USD` | `1` (per run, client-side estimate) |
| `AGENT_OFFICE_CLAUDE_BIN` | `claude` |
| `AGENT_OFFICE_ALLOW_API_KEY` | unset |
| `AGENT_OFFICE_PERSONA` | built-in Korean persona; custom text replaces it, `off` disables it |
