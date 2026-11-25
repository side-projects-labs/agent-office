import { NextResponse } from "next/server";

import {
  defaultStudioSettings,
  mergeStudioSettings,
  sanitizeStudioGatewaySettings,
  sanitizeStudioSettings,
  type StudioSettings,
  type StudioSettingsPatch,
} from "@/lib/studio/settings";
import {
  applyStudioSettingsPatch,
  loadLocalGatewayDefaults,
  loadStudioSettings,
} from "@/lib/studio/settings-store";

export const runtime = "nodejs";

// Replay mode (static deploys such as Vercel): the filesystem is read-only and
// there is no gateway, so settings live in memory and point at the in-browser
// replay socket. Nothing is persisted.
const isReplayMode = () => process.env.NEXT_PUBLIC_REPLAY_MODE === "1";
const replayBase = (): StudioSettings => ({
  ...defaultStudioSettings(),
  gateway: { url: "replay://local", token: "", adapterType: "demo" },
});
let replaySettings: StudioSettings | null = null;
const replayResponse = (settings: StudioSettings) =>
  NextResponse.json(
    {
      settings: sanitizeStudioSettings(settings),
      localGatewayDefaults: sanitizeStudioGatewaySettings(replayBase().gateway),
    },
    { headers: { "Cache-Control": "no-store" } }
  );

const isPatch = (value: unknown): value is StudioSettingsPatch =>
  Boolean(value && typeof value === "object");

export async function GET() {
  if (isReplayMode()) return replayResponse((replaySettings ??= replayBase()));
  try {
    const settings = loadStudioSettings();
    const localGatewayDefaults = loadLocalGatewayDefaults();
    return NextResponse.json(
      {
        settings: sanitizeStudioSettings(settings),
        localGatewayDefaults: sanitizeStudioGatewaySettings(localGatewayDefaults),
        // gatewayPrivate and localGatewayDefaultsPrivate are intentionally omitted.
        // Upstream tokens must not cross the browser API boundary — the Studio proxy
        // (server/gateway-proxy.js) injects the server-side token into connect frames.
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load studio settings.";
    console.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  if (isReplayMode()) {
    try {
      const body = JSON.parse(await request.text()) as unknown;
      if (!isPatch(body)) {
        return NextResponse.json({ error: "Invalid settings payload." }, { status: 400 });
      }
      replaySettings = mergeStudioSettings(replaySettings ?? replayBase(), body);
      // Never let a client move the replay deployment off the replay socket.
      replaySettings = { ...replaySettings, gateway: replayBase().gateway };
      return replayResponse(replaySettings);
    } catch {
      return NextResponse.json({ error: "Invalid settings payload." }, { status: 400 });
    }
  }
  try {
    const rawBody = await request.text();
    if (!rawBody.trim()) {
      return NextResponse.json({ error: "Invalid settings payload." }, { status: 400 });
    }
    const body = JSON.parse(rawBody) as unknown;
    if (!isPatch(body)) {
      return NextResponse.json({ error: "Invalid settings payload." }, { status: 400 });
    }
    const settings = applyStudioSettingsPatch(body);
    return NextResponse.json(
      {
        settings: sanitizeStudioSettings(settings),
        localGatewayDefaults: sanitizeStudioGatewaySettings(loadLocalGatewayDefaults()),
        // gatewayPrivate intentionally omitted — see GET handler comment.
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save studio settings.";
    console.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
