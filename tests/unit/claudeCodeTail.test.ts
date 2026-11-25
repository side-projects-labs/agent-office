import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { createTail } = require("../../server/claude-code/tail.js");

type Tail = { poll(): void; stop(): void };

let dir: string;
let file: string;
let lines: string[];
let tails: Tail[];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tail-"));
  file = path.join(dir, "sub", "events.jsonl");
  lines = [];
  tails = [];
});
afterEach(() => {
  for (const t of tails) t.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

const make = (options: { maxBytes?: number; startAtEnd?: boolean } = {}): Tail => {
  const tail: Tail = createTail({ file, onLine: (l: string) => lines.push(l), pollMs: 3_600_000, ...options });
  tails.push(tail);
  return tail;
};

describe("createTail", () => {
  it("creates the file privately and only reports lines appended after it starts", () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "old\n");
    const tail = make();
    fs.appendFileSync(file, "a\nb\n");
    tail.poll();
    expect(lines).toEqual(["a", "b"]);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
  });

  it("tightens permissions of an existing world-readable file and folder", () => {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o755 });
    fs.writeFileSync(file, "", { mode: 0o644 });
    make();
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
  });

  it("holds back a partial line until it is complete", () => {
    const tail = make();
    fs.appendFileSync(file, '{"a":');
    tail.poll();
    expect(lines).toEqual([]);
    fs.appendFileSync(file, "1}\n");
    tail.poll();
    expect(lines).toEqual(['{"a":1}']);
  });

  it("can read from the beginning", () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "x\ny\n");
    make({ startAtEnd: false }).poll();
    expect(lines).toEqual(["x", "y"]);
  });

  it("empties the file once it exceeds maxBytes and everything was consumed, and keeps following", () => {
    const tail = make({ maxBytes: 20 });
    fs.appendFileSync(file, "0123456789\n0123456789\n");
    tail.poll();
    expect(lines).toEqual(["0123456789", "0123456789"]);
    expect(fs.statSync(file).size).toBe(0);

    fs.appendFileSync(file, "after\n");
    tail.poll();
    expect(lines.at(-1)).toBe("after");
  });

  it("does not empty the file while a partial line is pending", () => {
    const tail = make({ maxBytes: 10 });
    fs.appendFileSync(file, "0123456789ABCDEF"); // no newline yet
    tail.poll();
    expect(fs.statSync(file).size).toBeGreaterThan(0);
    fs.appendFileSync(file, "\n");
    tail.poll();
    expect(lines).toEqual(["0123456789ABCDEF"]);
  });

  it("recovers when the file is truncated by someone else", () => {
    const tail = make();
    fs.appendFileSync(file, "one\ntwo\n");
    tail.poll();
    fs.truncateSync(file, 0);
    fs.appendFileSync(file, "three\n");
    tail.poll();
    expect(lines).toEqual(["one", "two", "three"]);
  });
});
