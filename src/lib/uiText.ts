/**
 * Minimal UI text for the avatar chat and approval surfaces, in Korean (default)
 * and English. Not a full i18n layer: only strings shown in the chat panel and
 * the approval tray. Aria-labels stay English on purpose (stable for tests and
 * assistive tooling). Set NEXT_PUBLIC_UI_LOCALE=en to use English.
 */
export type UiLocale = "ko" | "en";

export const UI_LOCALE: UiLocale = process.env.NEXT_PUBLIC_UI_LOCALE === "en" ? "en" : "ko";

const STRINGS = {
  en: {
    emptyHint: "Try describing a task, bug, or question to get started.",
    composerPlaceholder: "type a message",
    composerObserveOnly: "Observe-only: this office mirrors live Claude Code sessions",
    attach: "Attach",
    mic: "Mic",
    micRequesting: "Mic...",
    voiceStop: "Stop",
    stop: "Stop",
    stopping: "Stopping",
    send: "Send",
    approvalTitle: "Exec approval required",
    approvalHost: "Host",
    approvalExpires: "Expires",
    approvalCwd: "CWD",
    approvalAllowOnce: "Allow once",
    approvalAllowAlways: "Always allow",
    approvalDeny: "Deny",
    unknown: "unknown",
    trayTitle: "Approval needed",
    trayRemaining: "left",
    trayPending: "pending",
  },
  ko: {
    emptyHint: "작업, 버그, 질문을 자유롭게 설명해 주세요.",
    composerPlaceholder: "메시지를 입력하세요",
    composerObserveOnly: "관찰 전용: 이 사무실은 실행 중인 Claude Code 세션을 보여 줍니다",
    attach: "첨부",
    mic: "음성",
    micRequesting: "음성...",
    voiceStop: "중지",
    stop: "중지",
    stopping: "중지 중",
    send: "보내기",
    approvalTitle: "실행 승인이 필요합니다",
    approvalHost: "호스트",
    approvalExpires: "만료",
    approvalCwd: "작업 폴더",
    approvalAllowOnce: "이번만 허용",
    approvalAllowAlways: "항상 허용",
    approvalDeny: "거부",
    unknown: "알 수 없음",
    trayTitle: "승인 대기",
    trayRemaining: "남음",
    trayPending: "건 대기 중",
  },
} as const;

export type UiTextKey = keyof (typeof STRINGS)["en"];

export const t = (key: UiTextKey): string => STRINGS[UI_LOCALE][key];

export const EMPTY_CHAT_INTROS: readonly string[] =
  UI_LOCALE === "en"
    ? [
        "How can I help you today?",
        "What should we accomplish today?",
        "Ready when you are. What do you want to tackle?",
        "What are we working on today?",
        "I'm here and ready. What's the plan?",
      ]
    : [
        "오늘은 무엇을 도와드릴까요?",
        "오늘 무엇을 해낼까요?",
        "준비됐습니다. 어떤 일부터 시작할까요?",
        "오늘은 어떤 작업을 해 볼까요?",
        "저 여기 있어요. 계획이 어떻게 되나요?",
      ];
