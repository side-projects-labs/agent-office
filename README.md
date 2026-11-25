# agent-office

A 3D office for your Claude Code agents. Each Claude Code session is a character at a
desk: you can watch who is working, thinking or waiting for approval, and (locally)
give them work, answer their permission requests, and assign each avatar its own
project folder, role and personality.

**Live demo (replay only):** https://agent-office-4f86.vercel.app/office
The demo replays a short synthetic scenario in your browser. It does not call any AI
and cannot run anything.

Based on [Claw3D](https://github.com/iamlukethedev/Claw3D) by Luke The Dev (MIT).
Everything Claude Code specific lives under `server/claude-code*` and
`src/lib/gateway/replay`; the 3D office, chat and gateway protocol come from Claw3D.

## Three modes

| Mode | What it does | Where it runs | Cost |
|---|---|---|---|
| **Replay** | Plays a recorded, masked scenario | Browser only (static hosting, e.g. Vercel) | None |
| **Observe** | Shows your real Claude Code sessions as avatars (via hooks) | Your machine | None |
| **Runner** | Avatars you create from the UI do work through `claude -p`; permission requests are answered in the UI | Your machine only | Your Claude usage |

Runner mode needs the `claude` CLI and your login on the machine that runs it, so it
can never be part of the hosted demo.

## Quick start

Requires Node.js 20+.

```bash
npm install
cp .env.example .env
npm run dev                # Studio on http://localhost:3000
```

**Observe** your own sessions: start the adapter, then add the hook snippet from
[docs/claude-code-adapter.md](docs/claude-code-adapter.md) to the project you want to watch.

```bash
npm run claude-adapter
```

**Runner**: list the folders avatars may work in, then start the adapter.

```bash
# ~/.agent-office/config.json
# { "workspaces": [{ "id": "web", "label": "web-app", "path": "~/Desktop/web-app" }] }
npm run claude-adapter
```

Open http://localhost:3000/office, connect to `ws://localhost:18789`, and use **Add**
to create an avatar (pick its workspace, role and personality). Reading inside the
workspace runs automatically; writes, other shell commands and **anything outside the
workspace** ask for your approval in a card on screen. This is Claude Code's permission
system, not a sandbox: an approved command runs with your full privileges.

**Replay build** (what the demo uses): `npm run build:replay`.

Details, environment variables and limits: [docs/claude-code-adapter.md](docs/claude-code-adapter.md).

## Safety and billing, in short

- The adapter listens on `127.0.0.1` only. Do not expose it: anyone who can reach it can
  make your machine run Claude Code.
- Runner avatars can only work in folders listed in your config; the UI sends a
  workspace id, never a path.
- Runner runs use your Claude login. `ANTHROPIC_API_KEY` is removed from their
  environment so a stray key cannot silently switch you to API billing. Whether this
  use is permitted under your Claude plan is for you to check against Anthropic's
  terms; this project does not decide it for you.
- Recorded events can contain prompts and file paths. They are stored privately
  (`~/.agent-office`, mode 600) and must be masked before you publish them
  (`npm run fixture:mask`).
- The runner's cost figures are client-side estimates, not billing data.

## Development

```bash
npm run test -- --run     # unit tests
npm run lint
npm run typecheck
npm run fixture:demo      # regenerate the synthetic replay scenario
```

Project layout for the Claude Code parts:

```text
server/claude-code/core.js        hook events -> gateway frames (pure, shared with the browser replay)
server/claude-code/methods.js     gateway methods backed by that state
server/claude-code/runner.js      claude -p runner, workspaces, personas, persistence
server/claude-code/hook.js        hook that records events
server/claude-code/approval-hook.js   forwards permission requests to the UI
server/claude-code-adapter.js     WebSocket gateway that ties it together
src/lib/gateway/replay/           in-browser replay socket
```

## License

MIT. See [LICENSE](LICENSE). The original Claw3D copyright notice is kept.
