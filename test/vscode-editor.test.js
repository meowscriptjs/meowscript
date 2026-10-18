import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG, blockNames } from "../src/catalog.js";
import { tokenize } from "../src/lexer.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vscodeDir = path.join(root, "editors/vscode");

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(vscodeDir, relative), "utf8"));
}

const grammar = readJson("syntaxes/meowscript.tmLanguage.json");
const languageConfig = readJson("language-configuration.json");
const snippets = readJson("snippets/meowscript.json");
const manifest = readJson("package.json");

const categories = [...new Set(blockNames().map((name) => name.split(".")[0]))];
const hatNames = Object.entries(CATALOG)
  .filter(([, entry]) => entry.kind === "hat")
  .map(([name]) => name.split(".")[1]);

test("grammar: valid structure", () => {
  assert.equal(grammar.scopeName, "source.meowscript");
  for (const rule of grammar.patterns) {
    assert.ok(
      grammar.repository[rule.include.slice(1)],
      `missing repository entry for ${rule.include}`,
    );
  }
});

test("grammar: every catalog category is highlighted", () => {
  const match = grammar.repository["block-calls"].patterns[0].match;
  for (const category of categories) {
    assert.ok(
      match.includes(category),
      `category ${category} missing from block-calls rule`,
    );
  }
});

test("grammar: every catalog hat event is highlighted", () => {
  const match = grammar.repository["hat-events"].patterns[0].match;
  for (const hat of hatNames) {
    assert.ok(match.includes(hat), `hat ${hat} missing from hat-events rule`);
  }
});

test("grammar: statement keywords match the parser", () => {
  const match = grammar.repository.keywords.patterns
    .map((rule) => rule.match)
    .join(" ");
  for (const keyword of [
    "let",
    "cloud",
    "list",
    "function",
    "returning",
    "warp",
    "when",
    "if",
    "else",
    "repeat",
    "while",
    "forever",
    "return",
  ]) {
    assert.ok(
      new RegExp(`\\b${keyword}\\b`).test(match),
      `keyword ${keyword} missing from keywords rules`,
    );
  }
});

test("language configuration: comments match the lexer", () => {
  assert.equal(languageConfig.comments.lineComment, "//");
  assert.deepEqual(languageConfig.comments.blockComment, ["/*", "*/"]);
  // The lexer must actually accept the configured comment syntax.
  const tokens = tokenize("// line\n/* block */ let x = 1;");
  assert.deepEqual(
    tokens.filter((token) => token.type !== "eof").map((t) => t.value),
    ["let", "x", "=", "1", ";"],
  );
});

test("snippets: every snippet has a prefix and body", () => {
  const prefixes = new Set();
  for (const [name, snippet] of Object.entries(snippets)) {
    assert.ok(snippet.prefix, `${name} has no prefix`);
    assert.ok(
      Array.isArray(snippet.body) && snippet.body.length > 0,
      `${name} has no body`,
    );
    assert.ok(
      !prefixes.has(snippet.prefix),
      `duplicate prefix ${snippet.prefix}`,
    );
    prefixes.add(snippet.prefix);
  }
  assert.ok(prefixes.has("sprite") && prefixes.has("whenflag"));
});

test("manifest: contributions point at files that exist", () => {
  assert.equal(manifest.main, "./dist/extension.js");
  assert.equal(manifest.browser, "./dist/extension.js");
  assert.deepEqual(manifest.extensionKind, ["ui", "workspace"]);
  const [language] = manifest.contributes.languages;
  assert.equal(language.id, "meowscript");
  assert.deepEqual(language.extensions, [".ms"]);
  for (const file of [
    language.configuration,
    manifest.contributes.grammars[0].path,
    manifest.contributes.snippets[0].path,
  ]) {
    assert.ok(fs.existsSync(path.join(vscodeDir, file)), `missing ${file}`);
  }
});
