import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../src/build.js";
import { compile } from "../src/compiler.js";
import { decompile, decompileProject } from "../src/decompiler.js";
import { unzipSync } from "../src/sb3.js";
import { parse } from "../src/parser.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("decompiles a project back into parseable MeowScript", () => {
  const { sb3 } = build({ file: path.join(root, "examples/player.ms") });
  const source = decompile(sb3);
  assert.match(source, /sprite "Player Character" \{/);
  assert.match(source, /when greenFlag \{/);
  assert.match(source, /returning function getHealthStatus\(\)/);
  assert.match(source, /jump\(\);/);
  assert.doesNotThrow(() => parse(source, "roundtrip.ms"));
});

test("round-trips through compile -> decompile -> compile", () => {
  const first = build({ file: path.join(root, "examples/player.ms") });
  const source = decompile(first.sb3);
  const loadAsset = () =>
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>',
    );
  const { project } = compile(parse(source, "roundtrip.ms"), {
    project: {},
    loadAsset,
  });
  assert.deepEqual(
    project.targets.map((t) => t.name),
    ["Stage", "Player Character"],
  );
  assert.ok(project.extensions.includes("pen"));
});

test("reads project JSON directly as well as zipped sb3", () => {
  const { project, sb3 } = build({
    file: path.join(root, "examples/player.ms"),
  });
  assert.equal(decompile(project), decompile(sb3));
});

test("accepts an asset prefix when emitting costume references", () => {
  const { project } = build({ file: path.join(root, "examples/player.ms") });
  const source = decompileProject(project, { assetPrefix: "assets/" });
  assert.match(source, /idle: "assets\/[0-9a-f]+\.svg"/);
});

test("the sb3 zip contains project.json plus the referenced assets", () => {
  const { sb3, assets } = build({
    file: path.join(root, "examples/player.ms"),
  });
  const files = unzipSync(sb3);
  assert.ok(files.has("project.json"));
  for (const name of assets.keys())
    assert.ok(files.has(name), `missing asset ${name}`);
});
