"use client";

import { memo, useEffect, useState } from "react";

import type { ExecApprovalDecision, PendingExecApproval } from "@/features/agents/approvals/types";
import { useAllowAlwaysApproval } from "@/lib/gateway/observeOnly";
import { t } from "@/lib/uiText";

const formatRemaining = (expiresAtMs: number, nowMs: number): string => {
  const total = Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

/**
 * Floating list of pending exec approvals. Unlike the card inside an avatar's
 * chat, it is visible whether or not that chat is open, so a run that is
 * waiting on the user cannot go unnoticed. Also prefixes the tab title.
 */
export const OfficeApprovalTray = memo(function OfficeApprovalTray({
  approvals,
  agentName,
  onResolve,
}: {
  approvals: PendingExecApproval[];
  agentName: (agentId: string | null) => string;
  onResolve: (id: string, decision: ExecApprovalDecision) => void;
}) {
  const allowAlways = useAllowAlwaysApproval();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const count = approvals.length;

  useEffect(() => {
    if (count === 0) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [count]);

  useEffect(() => {
    if (count === 0) return;
    const original = document.title;
    document.title = `(${count}) ${t("trayTitle")} · ${original}`;
    return () => {
      document.title = original;
    };
  }, [count]);

  if (count === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-24 z-[70] flex flex-col items-center gap-2 px-4"
      data-testid="office-approval-tray"
      role="region"
      aria-label="Pending approvals"
    >
      {approvals.map((approval) => (
        <div
          key={approval.id}
          className="ui-badge-approval pointer-events-auto w-[min(92vw,560px)] rounded-md px-3 py-2 shadow-lg backdrop-blur"
          data-testid={`office-approval-${approval.id}`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="type-meta truncate">
              {t("trayTitle")} · {agentName(approval.agentId)}
            </div>
            <div className="shrink-0 font-mono text-[11px] text-muted-foreground">
              {formatRemaining(approval.expiresAtMs, nowMs)} {t("trayRemaining")}
            </div>
          </div>
          <div className="mt-2 max-h-24 overflow-auto rounded-md bg-surface-3 px-2 py-1.5 shadow-2xs">
            <div className="break-all font-mono text-[11px] font-semibold text-foreground">{approval.command}</div>
          </div>
          {approval.cwd ? (
            <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
              {t("approvalCwd")}: {approval.cwd}
            </div>
          ) : null}
          {approval.error ? (
            <div className="ui-alert-danger mt-2 rounded-md px-2 py-1 text-[11px] shadow-2xs">{approval.error}</div>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md border border-border/70 bg-surface-3 px-2.5 py-1 font-mono text-[12px] font-medium tracking-[0.02em] text-foreground transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => onResolve(approval.id, "allow-once")}
              disabled={approval.resolving}
              aria-label={`Allow once for exec approval ${approval.id}`}
            >
              {t("approvalAllowOnce")}
            </button>
            {allowAlways ? (
              <button
                type="button"
                className="rounded-md border border-border/70 bg-surface-3 px-2.5 py-1 font-mono text-[12px] font-medium tracking-[0.02em] text-foreground transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => onResolve(approval.id, "allow-always")}
                disabled={approval.resolving}
                aria-label={`Always allow for exec approval ${approval.id}`}
              >
                {t("approvalAllowAlways")}
              </button>
            ) : null}
            <button
              type="button"
              className="ui-btn-danger rounded-md px-2.5 py-1 font-mono text-[12px] font-medium tracking-[0.02em] transition disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => onResolve(approval.id, "deny")}
              disabled={approval.resolving}
              aria-label={`Deny exec approval ${approval.id}`}
            >
              {t("approvalDeny")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
});
