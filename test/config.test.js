import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseConfig,
  normalizeProject,
  configPayload,
  configComment,
  findConfigPath,
  loadConfigFrom,
  DEFAULT_PROJECT,
  CONFIG_MAGIC,
} from "../src/config.js";

test("parses the spec meowscript.yml fixture", () => {
  const { project } = parseConfig(`
project:
  name: "MeowScript Adventure"
  fps: 60
  width: 480
  height: 360
  turbo: false
  interpolation: true
  extensions:
    - "./assets/extensions/signals.js"
    - "https://extensions.penguinmod.com/some/text.js"
  unsandboxed:
    - signals
`);
  assert.equal(project.name, "MeowScript Adventure");
  assert.equal(project.framerate, 60);
  assert.equal(project.interpolation, true);
  assert.deepEqual(project.extensions, [
    "./assets/extensions/signals.js",
    "https://extensions.penguinmod.com/some/text.js",
  ]);
  assert.deepEqual(project.unsandboxed, ["signals"]);
});

test("normalizes a single unsandboxed extension to a list", () => {
  assert.deepEqual(normalizeProject({ unsandboxed: "coolExt" }).unsandboxed, [
    "coolExt",
  ]);
  assert.deepEqual(normalizeProject({}).unsandboxed, []);
});

test("normalizes aliases and defaults", () => {
  const project = normalizeProject({ interpolate: true, hq: true });
  assert.equal(project.interpolation, true);
  assert.equal(project.hq, true);
  assert.equal(project.framerate, DEFAULT_PROJECT.framerate);
});

test("configPayload only stores non-default values", () => {
  assert.deepEqual(configPayload({ ...DEFAULT_PROJECT }), {});
  assert.deepEqual(
    configPayload({ ...DEFAULT_PROJECT, framerate: 60, turbo: true }),
    {
      framerate: 60,
      turbo: true,
    },
  );
});

test("configComment returns null at defaults and ends with the magic string", () => {
  assert.equal(configComment({ ...DEFAULT_PROJECT }), null);
  const comment = configComment({
    ...DEFAULT_PROJECT,
    width: 640,
    interpolation: true,
  });
  assert.ok(comment.endsWith(CONFIG_MAGIC));
  const json = JSON.parse(
    comment.slice(comment.lastIndexOf("\n") + 1, -CONFIG_MAGIC.length),
  );
  assert.deepEqual(json, { interpolation: true, width: 640 });
});

test("findConfigPath walks up from a nested source directory", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meow-cfg-"));
  fs.writeFileSync(
    path.join(dir, "meowscript.yml"),
    'project:\n  name: "Root"\n',
  );
  fs.mkdirSync(path.join(dir, "src", "deep"), { recursive: true });
  assert.equal(
    findConfigPath(path.join(dir, "src", "deep")),
    path.join(dir, "meowscript.yml"),
  );
  assert.equal(
    loadConfigFrom(path.join(dir, "src", "deep")).project.name,
    "Root",
  );
});

test("loadConfigFrom falls back to defaults when nothing is found", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meow-empty-"));
  const { project, path: found } = loadConfigFrom(dir);
  assert.equal(found, null);
  assert.equal(project.name, DEFAULT_PROJECT.name);
});
