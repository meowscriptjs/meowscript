import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../src/build.js";
import { CATALOG } from "../src/catalog.js";
import { loadProject } from "./helpers/vm.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const showcase = path.join(root, "test/fixtures/all-blocks/all-blocks.ms");

test("the all-blocks showcase uses every catalog block", () => {
  const { project } = build({ file: showcase, useConfigFile: false });
  const opcodes = new Set();
  for (const target of project.targets) {
    for (const block of Object.values(target.blocks)) opcodes.add(block.opcode);
  }

  const missing = [];
  for (const [name, entry] of Object.entries(CATALOG)) {
    if (!opcodes.has(entry.opcode)) missing.push(`${name} -> ${entry.opcode}`);
  }
  assert.deepEqual(
    missing,
    [],
    `missing catalog blocks: ${missing.join(", ")}`,
  );
  assert.equal(Object.keys(CATALOG).length, 116);
});

test("the all-blocks showcase builds the expected project", () => {
  const result = build({ file: showcase });
  assert.deepEqual(
    result.project.targets.map((target) => target.name),
    ["Stage", "AllBlocks"],
  );
  assert.deepEqual(result.project.extensions, ["pen"]);
  // one explicit costume for the sprite plus the auto-generated Stage backdrop
  assert.equal(result.assets.size, 2);
});

test("the all-blocks showcase loads through the PenguinMod runtime", async () => {
  const { sb3 } = build({ file: showcase });
  const vm = await loadProject(sb3);
  assert.deepEqual(
    vm.runtime.targets.map((target) => target.getName()),
    ["Stage", "AllBlocks"],
  );
  const sprite = vm.runtime.targets.find((target) => !target.isStage);
  assert.ok(Object.keys(sprite.blocks._blocks).length > 0);
  // Serializing the loaded workspace back to XML is what the editor does on
  // open; it must not choke on any of the emitted blocks.
  assert.doesNotThrow(() => sprite.blocks.toXML(sprite.comments));
});

test("every terminal block in the showcase has no trailing statements", () => {
  const { project } = build({ file: showcase });
  const terminal = new Set(["procedures_return", "control_delete_this_clone"]);
  for (const target of project.targets) {
    for (const block of Object.values(target.blocks)) {
      if (terminal.has(block.opcode)) {
        assert.equal(block.next, null, `${block.opcode} must not have a next`);
      }
      if (block.opcode === "control_stop" && block.mutation) {
        // "other scripts in sprite" grows a next connection; "all" and
        // "this script" do not.
        const hasNext = block.mutation.hasnext === true;
        assert.equal(
          Boolean(block.next),
          hasNext,
          "control_stop next must match its hasnext mutation",
        );
      }
    }
  }
});
