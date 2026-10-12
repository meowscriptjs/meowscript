import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../src/build.js";
import { compile } from "../src/compiler.js";
import { parse } from "../src/parser.js";
import { CompileError } from "../src/errors.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function opcodes(project) {
  return project.targets.flatMap((t) =>
    Object.values(t.blocks).map((b) => b.opcode),
  );
}

test("compiles the spec fixture with pen extension and assets", () => {
  const result = build({ file: path.join(root, "examples/player.ms") });
  assert.deepEqual(
    result.project.targets.map((t) => t.name),
    ["Stage", "Player Character"],
  );
  assert.ok(result.project.extensions.includes("pen"));
  assert.equal(result.assets.size, 3);
  const codes = opcodes(result.project);
  assert.ok(codes.includes("motion_gotoxy"));
  assert.ok(codes.includes("procedures_definition"));
  assert.ok(codes.includes("procedures_call"));
  assert.ok(codes.includes("procedures_return"));
  assert.ok(codes.includes("pen_stamp"));
});

test("compiles a standalone source string with variables and list operations", () => {
  const ast = parse(
    `
        sprite "Bot" {
            let score = 0;
            list items = ["a"];
            when greenFlag {
                score += 1;
                items.push("b");
                items.deleteAll();
                looks.say(items.itemAt(1));
            }
        }
    `,
    "inline.ms",
  );
  const { project } = compile(ast, { project: { width: 480, height: 360 } });
  const codes = opcodes(project);
  assert.ok(codes.includes("data_changevariableby"));
  assert.ok(codes.includes("data_addtolist"));
  assert.ok(codes.includes("data_deletealloflist"));
  assert.ok(codes.includes("data_itemoflist"));
});

test("marks returning procedures with a return mutation", () => {
  const ast = parse(
    `
        sprite "Bot" {
            returning function level() { return 3; }
            when greenFlag { looks.say(level()); }
        }
    `,
    "inline.ms",
  );
  const { project } = compile(ast, { project: {} });
  const sprite = project.targets.find((t) => !t.isStage);
  const call = Object.values(sprite.blocks).find(
    (b) => b.opcode === "procedures_call",
  );
  assert.equal(call.mutation.return, "1");
  const def = Object.values(sprite.blocks).find(
    (b) => b.opcode === "procedures_definition",
  );
  const proto = sprite.blocks[def.inputs.custom_block[1]];
  assert.equal(proto.mutation.proccode, "level");
});

test("normalizes hex colors and emits a stop mutation", () => {
  const ast = parse(
    `
        sprite "Bot" {
            when greenFlag {
                pen.setColor("#abc");
                control.stop("other scripts in sprite");
            }
        }
    `,
    "inline.ms",
  );
  const { project } = compile(ast, { project: {} });
  const sprite = project.targets.find((t) => !t.isStage);
  const pen = Object.values(sprite.blocks).find(
    (b) => b.opcode === "pen_setPenColorToColor",
  );
  assert.deepEqual(pen.inputs.COLOR[1], [9, "#aabbcc"]);
  const stop = Object.values(sprite.blocks).find(
    (b) => b.opcode === "control_stop",
  );
  assert.equal(stop.mutation.hasnext, true);
});

test("orders dropdowns before value inputs for mixed blocks", () => {
  const ast = parse(
    `
        sprite "S" {
            when greenFlag {
                looks.setEffect("ghost", 25);
                looks.say(operators.math("sqrt", 9));
            }
        }
    `,
    "inline.ms",
  );
  const { project } = compile(ast, { project: {} });
  const sprite = project.targets.find((t) => !t.isStage);
  const setEffect = Object.values(sprite.blocks).find(
    (b) => b.opcode === "looks_seteffectto",
  );
  assert.deepEqual(setEffect.fields.EFFECT, ["ghost"]);
  assert.deepEqual(setEffect.inputs.VALUE[1], [4, "25"]);
  const math = Object.values(sprite.blocks).find(
    (b) => b.opcode === "operator_mathop",
  );
  assert.deepEqual(math.fields.OPERATOR, ["sqrt"]);
  assert.deepEqual(math.inputs.NUM[1], [4, "9"]);
});

test("stores project settings in a stage _twconfig_ comment", () => {
  const result = build({
    source: 'sprite "S" { when greenFlag { looks.show(); } }',
    dir: root,
    projectConfig: {
      name: "x",
      framerate: 60,
      width: 480,
      height: 360,
      turbo: false,
      interpolation: true,
      hq: false,
      runtime: {},
      extensions: [],
    },
  });
  const stage = result.project.targets.find((t) => t.isStage);
  const comments = Object.values(stage.comments);
  assert.equal(comments.length, 1);
  assert.match(comments[0].text, /\/\/ _twconfig_$/);
  const json = JSON.parse(
    comments[0].text.slice(
      comments[0].text.lastIndexOf("\n") + 1,
      -" // _twconfig_".length,
    ),
  );
  assert.deepEqual(json, { framerate: 60, interpolation: true });
});

test("rejects statements outside a hat", () => {
  const ast = parse('sprite "S" { looks.show(); }', "inline.ms");
  assert.throws(
    () => compile(ast, { project: {} }),
    (err) => {
      assert.ok(err instanceof CompileError);
      assert.match(err.message, /inside a `when/);
      return true;
    },
  );
});

test("rejects unknown blocks", () => {
  const ast = parse(
    'sprite "S" { when greenFlag { motion.teleport(1); } }',
    "inline.ms",
  );
  assert.throws(() => compile(ast, { project: {} }), /Unknown block/);
});

test("emits the pen extension only when pen blocks are used", () => {
  const withPen = build({ file: path.join(root, "examples/player.ms") });
  assert.deepEqual(withPen.project.extensions, ["pen"]);

  const withoutPen = compile(
    parse('sprite "S" { when greenFlag { looks.show(); } }', "inline.ms"),
    { project: {} },
  );
  assert.deepEqual(withoutPen.project.extensions, []);
});
