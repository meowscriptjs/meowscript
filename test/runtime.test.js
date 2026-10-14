import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../src/build.js";
import { CONFIG_MAGIC } from "../src/config.js";
import { loadProject } from "./helpers/vm.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("generated sb3 loads through the PenguinMod runtime", async () => {
  const { sb3 } = build({
    file: path.join(root, "test/fixtures/player/player.ms"),
  });
  const vm = await loadProject(sb3);
  assert.deepEqual(
    vm.runtime.targets.map((target) => target.getName()),
    ["Stage", "Player Character"],
  );
  const sprite = vm.runtime.targets.find((target) => !target.isStage);
  assert.ok(Object.keys(sprite.blocks._blocks).length > 0);
});

test("a forever loop with blocks below it survives a workspace update", async () => {
  // PenguinMod's editor reads the emitted workspace XML back through Blockly,
  // where `control_forever` only has a next-statement connection when its
  // mutation asks for one. Loading a project whose loop has blocks under it but
  // no nub mutation throws inside Blockly and loses the whole workspace.
  const { sb3 } = build({
    source: `
        sprite "Cat" {
            costumes: { idle: "assets/costumes/player_idle.svg" };
            when greenFlag {
                control.forever { looks.show(); }
                looks.hide();
            }
        }
    `,
    dir: root,
  });
  const vm = await loadProject(sb3);
  const sprite = vm.runtime.targets.find((target) => !target.isStage);
  const loop = Object.values(sprite.blocks._blocks).find(
    (block) => block.opcode === "control_forever",
  );
  assert.equal(loop.mutation.hasbreak, true);
  assert.equal(sprite.blocks._blocks[loop.next].opcode, "looks_hide");
  const xml = sprite.blocks.toXML(sprite.comments);
  assert.match(
    xml,
    /<mutation hasbreak="true"><\/mutation><value name="SUBSTACK">/,
  );
  assert.match(xml, /<\/value><next><block[\s\S]*?looks_hide/);
});

test("a returning custom block yields its value at runtime", async () => {
  // Regression: value-returning procedures must emit a
  // `procedures_definition_return` definition and call with
  // `mutation.returns === "true"`. Without those, PenguinMod treats the call as
  // a command and the assigned variable stays empty.
  const { sb3 } = build({
    source: `
        sprite "Bot" {
            costumes: { idle: "assets/costumes/player_idle.svg" };
            let result = "unset";
            returning function level() {
                if (3 > 10) { return "Pro"; }
                return "Rookie";
            }
            when greenFlag { result = level(); }
        }
    `,
    dir: root,
  });
  const vm = await loadProject(sb3);
  const sprite = vm.runtime.targets.find((target) => !target.isStage);
  vm.greenFlag();
  for (let i = 0; i < 20; i += 1) vm.runtime._step();
  const varId = Object.keys(sprite.variables).find(
    (id) => sprite.variables[id].name === "result",
  );
  assert.ok(varId, "result variable should exist");
  assert.equal(sprite.variables[varId].value, "Rookie");
});

test("the runtime recognises the stored config comment", async () => {
  const { sb3 } = build({
    file: path.join(root, "test/fixtures/player/player.ms"),
  });
  const vm = await loadProject(sb3);
  const stage = vm.runtime.targets.find((target) => target.isStage);
  const comments = Object.values(stage.comments).map((comment) => comment.text);
  assert.ok(comments.some((text) => text.includes(CONFIG_MAGIC)));
});
