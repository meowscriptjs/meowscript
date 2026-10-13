import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../src/build.js";
import { loadProject } from "./helpers/vm.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const examplesDir = path.join(root, "examples");

/** Every directory under `examples/` that contains at least one `.ms` file. */
function exampleProjects() {
  return fs
    .readdirSync(examplesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      dir: path.join(examplesDir, entry.name),
    }))
    .filter(({ dir }) =>
      fs.readdirSync(dir).some((file) => file.endsWith(".ms")),
    );
}

test("there is at least one runnable example", () => {
  assert.ok(exampleProjects().length > 0, "examples/ should hold demos");
});

test("every example compiles to a project with a sprite", () => {
  for (const { name, dir } of exampleProjects()) {
    const { project } = build({ dir });
    assert.ok(
      project.targets.some((target) => !target.isStage),
      `${name} should declare a sprite`,
    );
    const blocks = project.targets.flatMap((target) =>
      Object.values(target.blocks),
    );
    assert.ok(
      blocks.some(
        (block) => block.topLevel && block.opcode.startsWith("event_"),
      ),
      `${name} should have at least one event hat`,
    );
  }
});

test("every example loads and runs in the PenguinMod runtime", async () => {
  for (const { name, dir } of exampleProjects()) {
    const { sb3 } = build({ dir });
    const vm = await loadProject(sb3);
    assert.ok(vm.runtime.targets.length > 1, `${name} should load its sprites`);
    vm.greenFlag();
    assert.doesNotThrow(() => {
      for (let i = 0; i < 10; i += 1) vm.runtime._step();
    }, `${name} should survive a few frames`);
    vm.stopAll();
  }
});
