import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { KO } from "@/lib/i18n/ko";

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
};

const usedKeys = (): Set<string> => {
  const keys = new Set<string>();
  const call = /\btr\(("(?:[^"\\]|\\.)*")\)/g;
  for (const file of walk(path.resolve(__dirname, "../../src"))) {
    for (const match of fs.readFileSync(file, "utf8").matchAll(call)) {
      keys.add(JSON.parse(match[1]) as string);
    }
  }
  return keys;
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("tr", () => {
  it("returns the English text in English mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_UI_LOCALE", "en");
    vi.resetModules();
    const { tr } = await import("@/lib/i18n");
    expect(tr("Cancel")).toBe("Cancel");
  });

  it("translates known text in Korean mode and leaves unknown text untouched", async () => {
    vi.stubEnv("NEXT_PUBLIC_UI_LOCALE", "ko");
    vi.resetModules();
    const { tr } = await import("@/lib/i18n");
    expect(tr("Cancel")).toBe("취소");
    expect(tr("Add Agent")).toBe("에이전트 추가");
    expect(tr("Some text nobody translated")).toBe("Some text nobody translated");
  });
});

describe("Korean dictionary", () => {
  it("has no stale entries: every key is used by a tr() call in src", () => {
    const used = usedKeys();
    const stale = Object.keys(KO).filter((key) => !used.has(key));
    expect(stale).toEqual([]);
  });

  it("has no empty translations", () => {
    const empty = Object.entries(KO).filter(([, value]) => value.trim() === "");
    expect(empty).toEqual([]);
  });

  it("covers almost every tr() call (leftovers are deliberate: code, URLs, fragments)", () => {
    const used = usedKeys();
    const missing = [...used].filter((key) => !(key in KO));
    expect(missing.length / used.size).toBeLessThan(0.1);
  });
});
