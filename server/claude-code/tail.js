"use strict";

/**
 * Follows an append-only JSONL file (written by hook.js) and calls onLine for
 * each complete line. The file holds prompts and tool inputs, so it is kept
 * private (0600 in a 0700 folder) and emptied once it grows past maxBytes and
 * everything in it has been consumed, so it cannot grow without bound.
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

function createTail({ file, onLine, maxBytes = DEFAULT_MAX_BYTES, pollMs = 300, startAtEnd = true }) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(file)) fs.writeFileSync(file, "", { mode: 0o600 });
  // Files and folders from older versions may be world-readable.
  try {
    fs.chmodSync(file, 0o600);
    fs.chmodSync(dir, 0o700);
  } catch {
    // best effort (e.g. a folder we do not own)
  }

  let offset = startAtEnd ? fs.statSync(file).size : 0;
  let carry = "";

  function poll() {
    let size;
    try {
      size = fs.statSync(file).size;
    } catch {
      return;
    }
    if (size < offset) {
      // truncated or replaced by someone else
      offset = 0;
      carry = "";
    }
    if (size > offset) {
      const fd = fs.openSync(file, "r");
      try {
        const buf = Buffer.alloc(size - offset);
        fs.readSync(fd, buf, 0, buf.length, offset);
        offset = size;
        const lines = (carry + buf.toString("utf8")).split("\n");
        carry = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) onLine(line);
      } finally {
        fs.closeSync(fd);
      }
    }
    if (maxBytes > 0 && offset >= maxBytes && offset === size && carry === "") {
      try {
        fs.truncateSync(file, 0);
        offset = 0;
      } catch {
        // keep going; next poll retries
      }
    }
  }

  const timer = setInterval(poll, pollMs);
  timer.unref?.();
  return { poll, stop: () => clearInterval(timer) };
}

module.exports = { createTail, DEFAULT_MAX_BYTES };
