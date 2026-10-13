import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG } from "../src/catalog.js";
import { build } from "../src/build.js";
import { decompile } from "../src/decompiler.js";
import { compile } from "../src/compiler.js";
import { parse } from "../src/parser.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const showcase = path.join(root, "test/fixtures/all-blocks/all-blocks.ms");

// Shadow-menu block opcodes and the field name each one carries. Taken from
// PenguinMod's fork of scratch-blocks (`blocks_vertical/*.js`) and the
// PenguinMod GUI (`src/lib/blocks.js`), which override the runtime menus.
const MENU_FIELDS = {
  motion_goto_menu: "TO",
  motion_glideto_menu: "TO",
  motion_pointtowards_menu: "TOWARDS",
  sensing_touchingobjectmenu: "TOUCHINGOBJECTMENU",
  sensing_distancetomenu: "DISTANCETOMENU",
  sensing_keyoptions: "KEY_OPTION",
  sensing_of_object_menu: "OBJECT",
  looks_costume: "COSTUME",
  looks_backdrops: "BACKDROP",
  sound_sounds_menu: "SOUND_MENU",
  control_create_clone_of_menu: "CLONE_OPTION",
  pen_menu_colorParam: "colorParam",
};

function allBlocks(project) {
  const byId = new Map();
  for (const target of project.targets) {
    for (const [id, block] of Object.entries(target.blocks))
      byId.set(id, block);
  }
  return byId;
}

test("every catalog dropdown input targets a known shadow menu field", () => {
  const problems = [];
  for (const [name, entry] of Object.entries(CATALOG)) {
    for (const [input, spec] of Object.entries(entry.inputs || {})) {
      if (spec.type !== "menu") continue;
      const expected = MENU_FIELDS[spec.menu];
      if (expected === undefined)
        problems.push(`${name}.${input}: unknown menu ${spec.menu}`);
      else if (expected !== spec.field)
        problems.push(
          `${name}.${input}: ${spec.menu} field ${spec.field} != ${expected}`,
        );
    }
  }
  assert.deepEqual(problems, []);
});

test("glide-to uses its own shadow menu, not the goto menu", () => {
  assert.equal(CATALOG["motion.goTo"].inputs.TO.menu, "motion_goto_menu");
  assert.equal(CATALOG["motion.glideTo"].inputs.TO.menu, "motion_glideto_menu");
});

test("greater-than hats use the WHENGREATERTHANMENU dropdown", () => {
  const cases = [
    ["events.loudnessGreaterThan", "LOUDNESS"],
    ["events.timerGreaterThan", "TIMER"],
  ];
  for (const [name, value] of cases) {
    const entry = CATALOG[name];
    assert.equal(entry.opcode, "event_whengreaterthan");
    const names = entry.args.map((arg) => arg.field || arg.input);
    assert.ok(names.includes("WHENGREATERTHANMENU"), `${name} field`);
    assert.ok(
      !names.includes("WHENGREATER"),
      `${name} must not use WHENGREATER`,
    );
    assert.equal(
      entry.args.find((arg) => arg.field === "WHENGREATERTHANMENU").value,
      value,
    );
  }
});

test("the compiled showcase serializes the corrected hat and glide blocks", () => {
  const { project } = build({ file: showcase, useConfigFile: false });
  const byId = allBlocks(project);
  const blocks = [...byId.values()];

  const greater = blocks.filter((b) => b.opcode === "event_whengreaterthan");
  assert.equal(greater.length, 2);
  for (const block of greater) {
    assert.ok(block.fields.WHENGREATERTHANMENU, "field present");
    assert.equal(block.fields.WHENGREATER, undefined, "stale field absent");
  }

  const glides = blocks.filter((b) => b.opcode === "motion_glideto");
  assert.equal(glides.length, 1);
  const toShadow = byId.get(glides[0].inputs.TO[1]);
  assert.equal(toShadow.opcode, "motion_glideto_menu");
  assert.equal(toShadow.fields.TO[0], "_mouse_");
});

test("the all-blocks showcase round-trips through decompile", () => {
  const first = build({ file: showcase, useConfigFile: false });
  const source = decompile(first.sb3);
  assert.match(source, /when loudnessGreaterThan\(/);
  assert.match(source, /when timerGreaterThan\(/);
  assert.match(source, /motion\.glideTo\(/);
  // Recompiling the decompiled source must not throw and must keep the blocks.
  const loadAsset = () =>
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>',
    );
  const { project } = compile(parse(source, "roundtrip.ms"), {
    project: {},
    loadAsset,
  });
  const opcodes = new Set(
    [...allBlocks(project).values()].map((block) => block.opcode),
  );
  assert.ok(opcodes.has("event_whengreaterthan"));
  assert.ok(opcodes.has("motion_glideto"));
  assert.ok(opcodes.has("motion_glideto_menu"));
});
