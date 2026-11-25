/**
 * Replay mode: static deploys (e.g. Vercel) with no gateway server. The office
 * plays a recorded, masked fixture and hides features that need a live backend.
 * Inlined at build time via NEXT_PUBLIC_REPLAY_MODE=1.
 */
export const IS_REPLAY_MODE = process.env.NEXT_PUBLIC_REPLAY_MODE === "1";
