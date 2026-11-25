import { KO } from "@/lib/i18n/ko";
import { UI_LOCALE } from "@/lib/uiText";

/**
 * Translate a literal UI string. The English text is the key, so a missing entry
 * simply stays English and nothing breaks. English mode (NEXT_PUBLIC_UI_LOCALE=en)
 * returns the text unchanged.
 */
export const tr = (text: string): string => (UI_LOCALE === "ko" ? (KO[text] ?? text) : text);
