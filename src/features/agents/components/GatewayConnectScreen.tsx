import { useMemo, useState } from "react";
import { Check, Copy, Eye, EyeOff } from "lucide-react";
import type { GatewayStatus } from "@/lib/gateway/GatewayClient";
import { isLocalGatewayUrl } from "@/lib/gateway/local-gateway";
import type { StudioGatewayAdapterType, StudioGatewaySettings } from "@/lib/studio/settings";
import { RunningAvatarLoader } from "@/features/agents/components/RunningAvatarLoader";
import { tr } from "@/lib/i18n";

type GatewayConnectScreenProps = {
  gatewayUrl: string;
  token: string;
  selectedAdapterType: StudioGatewayAdapterType;
  activeAdapterType: StudioGatewayAdapterType;
  localGatewayDefaults: StudioGatewaySettings | null;
  status: GatewayStatus;
  error: string | null;
  showApprovalHint: boolean;
  onGatewayUrlChange: (value: string) => void;
  onTokenChange: (value: string) => void;
  onAdapterTypeChange: (value: StudioGatewayAdapterType) => void;
  onUseLocalDefaults: () => void;
  onConnect: () => void;
};

const resolveLocalGatewayPort = (gatewayUrl: string): number => {
  try {
    const parsed = new URL(gatewayUrl);
    const port = Number(parsed.port);
    if (Number.isFinite(port) && port > 0) return port;
  } catch {}
  return 18789;
};

export const GatewayConnectScreen = ({
  gatewayUrl,
  token,
  selectedAdapterType,
  activeAdapterType,
  localGatewayDefaults,
  status,
  error,
  showApprovalHint,
  onGatewayUrlChange,
  onTokenChange,
  onAdapterTypeChange,
  onUseLocalDefaults,
  onConnect,
}: GatewayConnectScreenProps) => {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [showToken, setShowToken] = useState(false);
  const tokenOptional =
    selectedAdapterType === "hermes" ||
    selectedAdapterType === "demo" ||
    selectedAdapterType === "local" ||
    selectedAdapterType === "claw3d" ||
    selectedAdapterType === "custom";
  const isLocal = useMemo(() => isLocalGatewayUrl(gatewayUrl), [gatewayUrl]);
  const localPort = useMemo(() => resolveLocalGatewayPort(gatewayUrl), [gatewayUrl]);
  const localGatewayCommand = useMemo(
    () => `npx openclaw gateway run --bind loopback --port ${localPort} --verbose`,
    [localPort]
  );
  const localGatewayCommandPnpm = useMemo(
    () => `pnpm openclaw gateway run --bind loopback --port ${localPort} --verbose`,
    [localPort]
  );
  const localDemoCommand = useMemo(
    () => `npm run demo-gateway`,
    []
  );
  const useDemoPreset = () => {
    onAdapterTypeChange("demo");
  };
  const useHermesPreset = () => {
    onAdapterTypeChange("hermes");
  };
  const useOpenClawPreset = () => {
    onAdapterTypeChange("openclaw");
  };
  const useCustomPreset = () => {
    onAdapterTypeChange("custom");
  };
  const useLocalPreset = () => {
    onAdapterTypeChange("local");
  };
  const useClaw3dPreset = () => {
    onAdapterTypeChange("claw3d");
  };
  const statusCopy = useMemo(() => {
    if (status === "connecting" && isLocal) {
      return `Local gateway detected on port ${localPort}. Connecting…`;
    }
    if (status === "connecting") {
      return "Connecting to remote gateway…";
    }
    if (isLocal) {
      return "No local gateway found.";
    }
    return "Not connected to a gateway.";
  }, [isLocal, localPort, status]);
  const selectedAdapterHint = useMemo(() => {
    switch (selectedAdapterType) {
      case "openclaw":
        return "OpenClaw is the provider-rich gateway path. Use this when you want upstream model/provider routing managed by OpenClaw itself.";
      case "hermes":
        return "Hermes is the agent runtime path with its own provider/account flow behind the gateway.";
      case "demo":
        return "Demo can fall back to a seeded main agent locally, or connect to the bundled mock gateway for streaming replies.";
      case "local":
        return "Local runtime expects a direct HTTP runtime/orchestrator boundary, not a provider catalog.";
      case "claw3d":
        return "Claw3D runtime preserves Claw3D transcript conventions over the direct runtime seam.";
      case "custom":
      default:
        return "Custom is the generic direct runtime seam. Use it for compatible orchestrators, not for provider-specific auth flows.";
    }
  }, [selectedAdapterType]);
  const connectDisabled = status === "connecting";
  const connectLabel = connectDisabled ? "Connecting…" : "Connect";
  const statusDotClass =
    status === "connected"
      ? "ui-dot-status-connected"
      : status === "connecting"
        ? "ui-dot-status-connecting"
        : "ui-dot-status-disconnected";

  const copyLocalCommand = async () => {
    try {
      await navigator.clipboard.writeText(localGatewayCommand);
      setCopyStatus("copied");
      window.setTimeout(() => setCopyStatus("idle"), 1200);
    } catch {
      setCopyStatus("failed");
      window.setTimeout(() => setCopyStatus("idle"), 1800);
    }
  };

  const commandField = (
    <div className="space-y-1.5">
      <div className="ui-command-surface flex items-center gap-2 rounded-md px-3 py-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[12px] text-[var(--command-fg)]">
          {localGatewayCommand}
        </code>
        <button
          type="button"
          className="ui-btn-icon ui-command-copy h-7 w-7 shrink-0"
          onClick={copyLocalCommand}
          aria-label="Copy local gateway command"
          title={tr("Copy command")}
        >
          {copyStatus === "copied" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      {copyStatus === "copied" ? (
        <p className="text-xs text-muted-foreground">{tr("Copied")}</p>
      ) : copyStatus === "failed" ? (
        <p className="ui-text-danger text-xs">{tr("Could not copy command.")}</p>
      ) : (
        <p className="text-xs leading-snug text-muted-foreground">
          {tr("In a source checkout, use")} <span className="font-mono text-foreground">{localGatewayCommandPnpm}</span>.
        </p>
      )}
    </div>
  );

  const remoteForm = (
    <div className="mt-2.5 flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-[11px] font-medium text-foreground/90">
        {tr("Upstream URL")}
        <input
          className="ui-input h-10 rounded-md px-4 font-sans text-sm text-foreground outline-none"
          type="text"
          value={gatewayUrl}
          onChange={(event) => onGatewayUrlChange(event.target.value)}
          placeholder={tr("wss://your-gateway.example.com")}
          spellCheck={false}
        />
      </label>

      <div className="space-y-0.5 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">{tr("Using Tailscale?")}</p>
        <p>
          {tr("URL:")} <span className="font-mono">wss://&lt;your-tailnet-host&gt;</span>
        </p>
      </div>

      <label className="flex flex-col gap-1 text-[11px] font-medium text-foreground/90">
        {tokenOptional ? "Upstream token (optional)" : "Upstream token"}
        <div className="relative">
          <input
            className="ui-input h-10 w-full rounded-md px-4 pr-10 font-sans text-sm text-foreground outline-none"
            type={showToken ? "text" : "password"}
            value={token}
            onChange={(event) => onTokenChange(event.target.value)}
            placeholder={tokenOptional ? "optional token" : "gateway token"}
            spellCheck={false}
          />
          <button
            type="button"
            className="ui-btn-icon absolute inset-y-0 right-1 my-auto h-8 w-8 border-transparent bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground"
            aria-label={showToken ? "Hide token" : "Show token"}
            onClick={() => setShowToken((prev) => !prev)}
          >
            {showToken ? (
              <EyeOff className="h-4 w-4 transition-transform duration-150" />
            ) : (
              <Eye className="h-4 w-4 transition-transform duration-150" />
            )}
          </button>
        </div>
      </label>

      <button
        type="button"
        className="ui-btn-primary mt-1 h-11 w-full px-4 text-xs font-semibold tracking-[0.05em] disabled:cursor-not-allowed disabled:opacity-60"
        onClick={onConnect}
        disabled={connectDisabled || !gatewayUrl.trim()}
      >
        {connectLabel}
      </button>

      {status === "connecting" ? (
        <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <RunningAvatarLoader size={16} trackWidth={32} inline />
          {tr("Connecting…")}
        </div>
      ) : null}
      {error ? <p className="ui-text-danger text-xs leading-snug">{error}</p> : null}
      {showApprovalHint && selectedAdapterType === "openclaw" ? (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-3 text-xs text-muted-foreground">
          <p className="leading-snug">
            {tr("If the first connection attempt did not work, go to your OpenClaw computer and approve this device:")}
          </p>
          <code className="mt-2 block overflow-x-auto whitespace-nowrap rounded-md bg-[var(--command-bg)] px-2.5 py-2 font-mono text-[11px] text-[var(--command-fg)]">
            openclaw devices approve --latest
          </code>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-[820px] flex-1 flex-col gap-5">
      <div className="ui-card px-4 py-2">
        <div className="flex items-center gap-2">
          {status === "connecting" ? (
            <RunningAvatarLoader size={18} trackWidth={36} inline />
          ) : (
            <span
              className={`h-2.5 w-2.5 ${statusDotClass}`}
            />
          )}
          <p className="text-sm font-semibold text-foreground">{statusCopy}</p>
        </div>
      </div>

      <div className="ui-card px-4 py-5 sm:px-6">
        <div>
          <p className="font-mono text-[10px] font-medium tracking-[0.06em] text-muted-foreground">
            {tr("Remote gateway (recommended)")}
          </p>
          <p className="mt-2 text-sm text-foreground/90">
            {tr("Choose a backend, then connect to its gateway URL.")}
          </p>
          <p className="mt-2 font-mono text-[11px] text-muted-foreground">
            {tr("Selected backend:")} {selectedAdapterType} {tr("| Active backend:")} {activeAdapterType}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {tr("Each backend keeps its own saved URL and token.")}
          </p>
          <p className="mt-2 text-xs leading-snug text-muted-foreground">
            {selectedAdapterHint}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="ui-btn-secondary px-3 py-1.5 text-[11px] font-semibold tracking-[0.05em]"
              onClick={useDemoPreset}
            >
              {tr("Demo backend")}
            </button>
            <button
              type="button"
              className="ui-btn-secondary px-3 py-1.5 text-[11px] font-semibold tracking-[0.05em]"
              onClick={useHermesPreset}
            >
              {tr("Hermes backend")}
            </button>
            <button
              type="button"
              className="ui-btn-secondary px-3 py-1.5 text-[11px] font-semibold tracking-[0.05em]"
              onClick={useLocalPreset}
            >
              {tr("Local runtime")}
            </button>
            <button
              type="button"
              className="ui-btn-secondary px-3 py-1.5 text-[11px] font-semibold tracking-[0.05em]"
              onClick={useClaw3dPreset}
            >
              {tr("Claw3D runtime")}
            </button>
            <button
              type="button"
              className="ui-btn-secondary px-3 py-1.5 text-[11px] font-semibold tracking-[0.05em]"
              onClick={useCustomPreset}
            >
              {tr("Custom backend")}
            </button>
            <button
              type="button"
              className="ui-btn-secondary px-3 py-1.5 text-[11px] font-semibold tracking-[0.05em]"
              onClick={useOpenClawPreset}
            >
              {tr("OpenClaw backend")}
            </button>
          </div>
        </div>
        {remoteForm}
      </div>

      <div className="ui-card px-4 py-4 sm:px-6 sm:py-5">
        <div className="space-y-1.5">
          <p className="font-mono text-[10px] font-semibold tracking-[0.06em] text-muted-foreground">
            {tr("Run locally (optional)")}
          </p>
          <p className="text-sm text-foreground/90">
            {tr("Start a local gateway process on this machine, then connect.")}
          </p>
        </div>
        <div className="mt-3 space-y-3">
          {commandField}
          <div className="rounded-md border border-border bg-muted/30 px-3 py-3">
            <p className="text-xs font-medium text-foreground">{tr("Just want to see the office?")}</p>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">
              {tr("Run")} <span className="font-mono text-foreground">{localDemoCommand}</span> {tr("to start a built-in mock gateway with demo agents. Then choose")} <span className="font-mono text-foreground">{tr("Demo backend")}</span> {tr("and connect.")}
            </p>
          </div>
          <div className="rounded-md border border-border bg-muted/30 px-3 py-3">
            <p className="text-xs font-medium text-foreground">{tr("Using Hermes locally?")}</p>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">
              {tr("Run")} <span className="font-mono text-foreground">{tr("npm run hermes-adapter")}</span>{tr(", then choose")}
              <span className="font-mono text-foreground"> {tr("Hermes backend")}</span>{tr(". The default local URL is")}
              <span className="font-mono text-foreground"> {tr("ws://localhost:18789")}</span>.
            </p>
          </div>
          <div className="rounded-md border border-border bg-muted/30 px-3 py-3">
            <p className="text-xs font-medium text-foreground">{tr("Using a local or custom runtime?")}</p>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">
              {tr("Choose")} <span className="font-mono text-foreground">{tr("Local runtime")}</span>,
              <span className="font-mono text-foreground"> {tr("Claw3D runtime")}</span>{tr(", or")}
              <span className="font-mono text-foreground"> {tr("Custom backend")}</span> {tr("and point the URL at your orchestrator or runtime boundary. These profiles already preserve separate saved URLs and tokens, but transport-specific chat handoff still needs a follow-up slice.")}
            </p>
          </div>
          <div className="rounded-md border border-border bg-muted/30 px-3 py-3">
            <p className="text-xs font-medium text-foreground">{tr("Opening Claw3D from another machine?")}</p>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">
              {tr("Start Studio with")} <span className="font-mono text-foreground">{tr("HOST=0.0.0.0")}</span> {tr("(or a specific LAN/Tailscale host) and set")}
              <span className="font-mono text-foreground"> {tr("STUDIO_ACCESS_TOKEN")}</span> {tr("before exposing it beyond localhost. Gateway settings are stored on the Studio host, but OpenClaw device approval remains per browser/device.")}
            </p>
          </div>
          {localGatewayDefaults ? (
            <div className="ui-input rounded-md px-3 py-3">
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  {tr("Use token from")} <span className="font-mono">{tr("~/.openclaw/openclaw.json")}</span>.
                </p>
                <p className="font-mono text-[11px] text-foreground">
                  {localGatewayDefaults.url}
                </p>
                <button
                  type="button"
                  className="ui-btn-secondary h-9 w-full px-3 text-xs font-semibold tracking-[0.05em]"
                  onClick={onUseLocalDefaults}
                >
                  {tr("Use local defaults")}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
