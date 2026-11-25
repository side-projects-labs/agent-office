"use strict";

/**
 * Persists runner avatar profiles so avatars (and their Claude sessions)
 * survive adapter restarts. Plain JSON, written atomically.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

function defaultFile(env = process.env) {
  return env.AGENT_OFFICE_AGENTS_FILE || path.join(os.homedir(), ".agent-office", "agents.json");
}

function createProfileStore(file = defaultFile()) {
  function load() {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      return Array.isArray(raw.agents) ? raw.agents.filter((a) => a && typeof a.id === "string") : [];
    } catch (err) {
      if (err.code !== "ENOENT") console.error(`[claude-code-adapter] cannot read ${file}: ${err.message}`);
      return [];
    }
  }

  function save(profiles) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify({ version: 1, agents: profiles }, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  return { load, save, file };
}

module.exports = { createProfileStore };
