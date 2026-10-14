import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/lexer.js";
import { LexError } from "../src/errors.js";

test("tokenizes identifiers, numbers, strings and punctuation", () => {
  const tokens = tokenize('let x = 1.5 + "hi";');
  const values = tokens.map((t) => t.value);
  assert.deepEqual(values, ["let", "x", "=", "1.5", "+", "hi", ";", ""]);
  assert.equal(tokens[0].type, "ident");
  assert.equal(tokens[3].type, "number");
  assert.equal(tokens[5].type, "string");
  assert.equal(tokens.at(-1).type, "eof");
});

test("records 1-based line and column information", () => {
  const tokens = tokenize("a\n  b");
  assert.equal(tokens[0].line, 1);
  assert.equal(tokens[0].column, 1);
  assert.equal(tokens[1].line, 2);
  assert.equal(tokens[1].column, 3);
});

test("skips line and block comments", () => {
  const tokens = tokenize("a // comment\n/* block */ b");
  assert.deepEqual(
    tokens.map((t) => t.value),
    ["a", "b", ""],
  );
});

test("decodes string escapes", () => {
  const [tok] = tokenize('"a\\nb\\t\\"c"');
  assert.equal(tok.value, 'a\nb\t"c');
});

test("reports unterminated strings with a location", () => {
  assert.throws(
    () => tokenize('"oops'),
    (err) => {
      assert.ok(err instanceof LexError);
      assert.equal(err.line, 1);
      return true;
    },
  );
});
