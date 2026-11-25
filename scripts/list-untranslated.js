#!/usr/bin/env node
"use strict";

/**
 * Lists tr("...") strings in src that have no Korean translation yet.
 *   node scripts/list-untranslated.js
 * Add them to src/lib/i18n/ko.ts (key = the exact English text).
 */

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
};

const used = new Map();
const call = /\btr\(("(?:[^"\\]|\\.)*")\)/g;
for (const file of walk(path.join(root, "src"))) {
  const text = fs.readFileSync(file, "utf8");
  for (const match of text.matchAll(call)) {
    const key = JSON.parse(match[1]);
    if (!used.has(key)) used.set(key, path.relative(root, file));
  }
}

const dictionary = fs.readFileSync(path.join(root, "src/lib/i18n/ko.ts"), "utf8");
const translated = new Set(
  [...dictionary.matchAll(/^ {2}("(?:[^"\\]|\\.)*"): "/gm)].map((m) => JSON.parse(m[1])),
);

const missing = [...used].filter(([key]) => !translated.has(key));
for (const [key, file] of missing) console.log(`${file}\t${key}`);
console.log(`\n${missing.length} of ${used.size} tr() strings have no Korean translation.`);
