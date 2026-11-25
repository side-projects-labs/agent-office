/**
 * Browser-only WebSocket stand-in for replay mode.
 *
 * Speaks the same gateway protocol as server/claude-code-adapter.js but runs
 * entirely in the page: it feeds a recorded (masked) hook-event fixture through
 * the shared core translator, so a static deploy (e.g. Vercel, no WebSocket
 * server) can still show a live-looking office.
 */
import * as core from "../../../../server/claude-code/core.js";
import * as methods from "../../../../server/claude-code/methods.js";

export const REPLAY_URL_PREFIX = "replay://";
export const isReplayUrl = (url: string): boolean => url.startsWith(REPLAY_URL_PREFIX);
export const isReplayMode = (): boolean => process.env.NEXT_PUBLIC_REPLAY_MODE === "1";

const FIXTURE_URL = "/replay/demo.jsonl";
const LOOP_GAP_MS = 6000;

type SocketEvent = { data?: string; code?: number; reason?: string };
type Listener = ((event: SocketEvent) => void) | null;
type RequestFrame = { type?: string; id?: string; method?: string; params?: unknown };
type OutgoingFrame = { type?: string; event?: string; [key: string]: unknown };
type HookEvent = { t: number } & Record<string, unknown>;

export class ReplayWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = 0;
  onopen: Listener = null;
  onmessage: Listener = null;
  onclose: Listener = null;
  onerror: Listener = null;

  private state = core.createState();
  private handleMethod = methods.createHandler(this.state);
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private seq = 0;
  private connected = false;
  private playing = false;

  constructor(readonly url: string) {
    this.later(0, () => {
      this.readyState = 1;
      this.onopen?.({});
      this.emit({ type: "event", event: "connect.challenge", payload: { nonce: "replay" } });
    });
  }

  send(data: string) {
    if (this.readyState !== 1) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    const frame = parsed as RequestFrame | null;
    if (!frame || frame.type !== "req" || typeof frame.id !== "string") return;

    if (frame.method === "connect") {
      this.connected = true;
      this.respond(methods.resOk(frame.id, methods.buildHello(this.state)));
      this.startPlayback();
      return;
    }
    if (!this.connected) {
      this.respond(methods.resErr(frame.id, "not_connected", "Send connect first."));
      return;
    }
    void this.handleMethod(frame.method, frame.params, frame.id).then((res: unknown) => this.respond(res));
  }

  close(code = 1000, reason = "") {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.playing = false;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.onclose?.({ code, reason });
  }

  private later(ms: number, fn: () => void) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.readyState !== 3) fn();
    }, ms);
    this.timers.add(timer);
  }

  private respond(frame: unknown) {
    if (this.readyState !== 1) return;
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  /** Events get one monotonically increasing seq per connection. */
  private emit(frame: OutgoingFrame) {
    if (this.readyState !== 1) return;
    const out = frame.type === "event" && frame.event !== "connect.challenge" ? { ...frame, seq: this.seq++ } : frame;
    this.onmessage?.({ data: JSON.stringify(out) });
  }

  private async startPlayback() {
    if (this.playing) return;
    this.playing = true;
    let events: HookEvent[];
    try {
      const res = await fetch(FIXTURE_URL);
      const text = await res.text();
      events = text
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as HookEvent)
        .sort((a, b) => a.t - b.t);
    } catch {
      this.onerror?.({});
      return;
    }
    if (events.length === 0) return;
    this.scheduleRound(events);
  }

  private scheduleRound(events: HookEvent[]) {
    const startedAt = Date.now();
    for (const ev of events) {
      this.later(ev.t, () => {
        const { frames } = core.applyHookEvent(this.state, { ...ev, ts: startedAt + ev.t });
        for (const frame of frames) this.emit(frame);
      });
    }
    const last = events[events.length - 1].t;
    this.later(last + LOOP_GAP_MS, () => {
      this.state.agents.clear();
      this.emit(core.presenceFrame(this.state));
      this.scheduleRound(events);
    });
  }
}
