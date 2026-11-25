import { describe, expect, it } from "vitest";
import { slugifyAgentName } from "@/lib/gateway/agentConfig";

describe("slugifyAgentName", () => {
  it("keeps ASCII names exactly as before", () => {
    expect(slugifyAgentName("My Agent")).toBe("my-agent");
    expect(slugifyAgentName("  Builder_2 ")).toBe("builder-2");
  });

  it("still rejects names with no usable characters at all", () => {
    expect(() => slugifyAgentName("!!!")).toThrow("Name produced an empty folder name.");
    expect(() => slugifyAgentName("   ")).toThrow("Name produced an empty folder name.");
  });

  it("gives Korean-only names a usable, stable slug", () => {
    const slug = slugifyAgentName("빌더");
    expect(slug).toMatch(/^agent-[a-z0-9]{4,6}$/);
    expect(slugifyAgentName("빌더")).toBe(slug);
    expect(slugifyAgentName(" 빌더 ")).toBe(slug);
  });

  it("keeps the ASCII part of mixed names and avoids collisions", () => {
    const a = slugifyAgentName("테스터1");
    const b = slugifyAgentName("빌더1");
    expect(a).toMatch(/^1-[a-z0-9]{4,6}$/);
    expect(b).toMatch(/^1-[a-z0-9]{4,6}$/);
    expect(a).not.toBe(b);
    expect(slugifyAgentName("Dev 빌더")).toMatch(/^dev-[a-z0-9]{4,6}$/);
  });

  it("produces different slugs for different Korean names", () => {
    const names = ["빌더", "리서처", "오케스트라", "테스터", "문서담당"];
    expect(new Set(names.map(slugifyAgentName)).size).toBe(names.length);
  });
});
