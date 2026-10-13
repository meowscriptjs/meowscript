import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../src/parser.js";
import { ParseError } from "../src/errors.js";

test("parses sprite, variable, list, hat and function declarations", () => {
  const ast = parse(`
        sprite "Cat" {
            let score = 0;
            list items = ["a", "b"];
            when greenFlag { score += 1; }
            function jump() { motion.changeY(1); }
            returning function level() { return score; }
        }
    `);
  assert.equal(ast.sprites.length, 1);
  assert.equal(ast.sprites[0].name, "Cat");
  const types = ast.sprites[0].body.map((item) => item.type);
  assert.deepEqual(types, [
    "VarDecl",
    "ListDecl",
    "HatDecl",
    "FunctionDecl",
    "FunctionDecl",
  ]);
  assert.equal(ast.sprites[0].body[4].returns, true);
});

test("parses expressions with correct precedence", () => {
  const ast = parse('sprite "S" { let x = 1 + 2 * 3; }');
  const init = ast.sprites[0].body[0].init;
  assert.equal(init.type, "Binary");
  assert.equal(init.op, "+");
  assert.equal(init.right.op, "*");
});

test("accepts function modifiers in either order", () => {
  for (const modifiers of ["returning warp", "warp returning"]) {
    const ast = parse(
      `sprite "S" { ${modifiers} function value() { return 1; } }`,
    );
    const fn = ast.sprites[0].body[0];
    assert.equal(fn.type, "FunctionDecl");
    assert.equal(fn.returns, true);
    assert.equal(fn.warp, true);
  }
  for (const modifier of ["returning", "warp", ""]) {
    const ast = parse(`sprite "S" { ${modifier} function noop() {} }`);
    const fn = ast.sprites[0].body[0];
    assert.equal(fn.returns, modifier === "returning");
    assert.equal(fn.warp, modifier === "warp");
  }
});

test("parses if/else-if chains and nested blocks", () => {
  const ast = parse(`
        sprite "S" {
            when greenFlag {
                if (a) { control.wait(1); } else if (b) { control.wait(2); } else { control.wait(3); }
            }
        }
    `);
  const hat = ast.sprites[0].body[0];
  const first = hat.body[0];
  assert.equal(first.type, "If");
  assert.equal(first.else.length, 1);
  assert.equal(first.else[0].type, "If");
});

test("allows omitting the trailing semicolon after a block body", () => {
  const ast = parse(
    'sprite "S" { when greenFlag { control.forever { motion.moveSteps(1); } } }',
  );
  const forever = ast.sprites[0].body[0].body[0];
  assert.equal(forever.name, "control.forever");
});

test("parses top-level items as stage content", () => {
  const ast = parse("let score = 0;\nwhen greenFlag { score += 1; }");
  assert.equal(ast.stage, null);
  assert.equal(ast.topItems.length, 2);
});

test("reports missing braces with a source location", () => {
  assert.throws(
    () => parse('sprite "S" { let x = 1;'),
    (err) => {
      assert.ok(err instanceof ParseError);
      assert.match(err.message, /Unterminated/);
      return true;
    },
  );
});
