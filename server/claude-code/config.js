"use strict";

/**
 * Runner configuration: which folders avatars may work in.
 *
 * Sources (merged):
 *  - ~/.agent-office/config.json (or AGENT_OFFICE_CONFIG):
 *      { "workspaces": [{ "id": "web", "label": "web-app", "path": "~/Desktop/web-app" }],
 *        "defaultWorkspace": "web" }
 *  - AGENT_OFFICE_WORKDIR: a single folder, added as workspace "default".
 *
 * The UI only ever sends a workspace id. Paths come from this file, so the UI
 * cannot point an avatar at an arbitrary folder.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function expandHome(p, home) {
  if (p === "~") return home;
  if (p.startsWith("~/")) return path.join(home, p.slice(2));
  return p;
}

function resolveDir(p, home) {
  const resolved = path.resolve(expandHome(String(p), home));
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) return null;
  return fs.realpathSync(resolved);
}

function loadConfig({ env = process.env, home = os.homedir() } = {}) {
  const warnings = [];
  const workspaces = [];
  const seenPaths = new Set();
  const add = (id, label, dirPath, source) => {
    if (!ID_PATTERN.test(id)) {
      warnings.push(`${source}: invalid workspace id "${id}" (use lowercase letters, digits, dashes)`);
      return;
    }
    if (workspaces.some((w) => w.id === id)) {
      warnings.push(`${source}: duplicate workspace id "${id}" ignored`);
      return;
    }
    const resolved = resolveDir(dirPath, home);
    if (!resolved) {
      warnings.push(`${source}: workspace "${id}" is not a directory: ${dirPath}`);
      return;
    }
    if (seenPaths.has(resolved)) {
      warnings.push(`${source}: workspace "${id}" repeats a folder already listed`);
      return;
    }
    seenPaths.add(resolved);
    workspaces.push({ id, label: label || path.basename(resolved), path: resolved });
  };

  const configPath = env.AGENT_OFFICE_CONFIG || path.join(home, ".agent-office", "config.json");
  let defaultFromFile = null;
  if (fs.existsSync(configPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (Array.isArray(raw.workspaces)) {
        for (const entry of raw.workspaces) {
          if (entry && typeof entry.id === "string" && typeof entry.path === "string") {
            add(entry.id, typeof entry.label === "string" ? entry.label : "", entry.path, configPath);
          } else {
            warnings.push(`${configPath}: workspace entries need "id" and "path"`);
          }
        }
      }
      if (typeof raw.defaultWorkspace === "string") defaultFromFile = raw.defaultWorkspace;
    } catch (err) {
      warnings.push(`${configPath}: cannot read config (${err.message})`);
    }
  }

  if (env.AGENT_OFFICE_WORKDIR) {
    add("default", "", env.AGENT_OFFICE_WORKDIR, "AGENT_OFFICE_WORKDIR");
  }

  let defaultWorkspaceId = workspaces[0]?.id ?? null;
  if (defaultFromFile) {
    if (workspaces.some((w) => w.id === defaultFromFile)) defaultWorkspaceId = defaultFromFile;
    else warnings.push(`defaultWorkspace "${defaultFromFile}" is not a valid workspace`);
  }
  return { workspaces, defaultWorkspaceId, warnings, configPath };
}

module.exports = { loadConfig, ID_PATTERN };
