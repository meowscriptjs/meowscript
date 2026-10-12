import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { discoverSources, mergePrograms } from "../src/project.js";
import { build } from "../src/build.js";
import { parse } from "../src/parser.js";
import { ParseError, CompileError } from "../src/errors.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "meowscript.js");

function tmp(prefix = "meow-proj-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

test("discovers .ms files recursively, skipping build and hidden directories", () => {
  const dir = tmp();
  write(path.join(dir, "stage.ms"), "");
  write(path.join(dir, "src", "a.ms"), "");
  write(path.join(dir, "src", "nested", "b.ms"), "");
  write(path.join(dir, "node_modules", "pkg", "nope.ms"), "");
  write(path.join(dir, "build", "nope.ms"), "");
  write(path.join(dir, ".hidden", "nope.ms"), "");
  write(path.join(dir, "notes.txt"), "");

  const found = discoverSources(dir).map((f) => path.relative(dir, f));
  assert.deepEqual(found, ["src/a.ms", "src/nested/b.ms", "stage.ms"]);
});

test("mergePrograms rejects more than one stage across files", () => {
  const a = parse("stage { let x = 0; }", "a.ms");
  const b = parse("stage { let y = 0; }", "b.ms");
  assert.throws(
    () =>
      mergePrograms([
        { ast: a, file: "a.ms" },
        { ast: b, file: "b.ms" },
      ]),
    (err) => {
      assert.ok(err instanceof ParseError);
      assert.match(err.message, /one stage/);
      return true;
    },
  );
});

test("mergePrograms rejects duplicate sprite names", () => {
  const a = parse('sprite "Cat" { when greenFlag { looks.show(); } }', "a.ms");
  const b = parse('sprite "Cat" { when greenFlag { looks.hide(); } }', "b.ms");
  assert.throws(
    () =>
      mergePrograms([
        { ast: a, file: "a.ms" },
        { ast: b, file: "b.ms" },
      ]),
    (err) => {
      assert.ok(err instanceof ParseError);
      assert.match(err.message, /Duplicate sprite/);
      assert.match(err.file, /b\.ms$/);
      return true;
    },
  );
});

test("build compiles every .ms file in a directory into one project", () => {
  const dir = tmp();
  write(path.join(dir, "meowscript.yml"), 'project:\n  name: "Merged"\n');
  write(
    path.join(dir, "src", "a.ms"),
    'sprite "A" { when greenFlag { looks.show(); } }',
  );
  write(
    path.join(dir, "src", "b.ms"),
    'sprite "B" { when greenFlag { looks.hide(); } }',
  );

  const result = build({ dir });
  assert.deepEqual(
    result.files.map((f) => path.basename(f)),
    ["a.ms", "b.ms"],
  );
  assert.deepEqual(
    result.project.targets.map((t) => t.name),
    ["Stage", "A", "B"],
  );
  assert.equal(result.config.name, "Merged");
});

test("shares globals and stage content declared across files", () => {
  const dir = tmp();
  write(path.join(dir, "globals.ms"), "let score = 7;");
  write(
    path.join(dir, "player.ms"),
    'sprite "P" { when greenFlag { looks.say(score); } }',
  );

  const result = build({ dir });
  const sprite = result.project.targets.find((t) => t.name === "P");
  const say = Object.values(sprite.blocks).find(
    (b) => b.opcode === "looks_say",
  );
  assert.equal(say.inputs.MESSAGE[1][0], 12);
  assert.equal(say.inputs.MESSAGE[1][1], "score");
});

test("resolves asset paths relative to the file that references them", () => {
  const dir = tmp();
  write(path.join(dir, "meowscript.yml"), 'project:\n  name: "Assets"\n');
  write(
    path.join(dir, "src", "cat.ms"),
    'sprite "Cat" {\n  costumes: { cat: "../assets/cat.svg" };\n  when greenFlag { looks.show(); }\n}',
  );
  write(
    path.join(dir, "assets", "cat.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>',
  );

  const result = build({ dir });
  const sprite = result.project.targets.find((t) => t.name === "Cat");
  assert.equal(sprite.costumes[0].name, "cat");
  // blank stage backdrop + the cat costume
  assert.equal(result.assets.size, 2);
});

test("reports duplicate globals declared in different files", () => {
  const dir = tmp();
  write(path.join(dir, "a.ms"), "let score = 0;");
  write(path.join(dir, "b.ms"), "let score = 1;");

  assert.throws(
    () => build({ dir }),
    (err) => {
      assert.ok(err instanceof CompileError);
      assert.match(err.message, /Duplicate global variable/);
      assert.match(err.file, /b\.ms$/);
      return true;
    },
  );
});

test("errors point at the file that actually contains the mistake", () => {
  const dir = tmp();
  write(
    path.join(dir, "a.ms"),
    'sprite "A" { when greenFlag { looks.show(); } }',
  );
  write(
    path.join(dir, "b.ms"),
    'sprite "B" { when greenFlag { motion.teleport(1); } }',
  );

  assert.throws(
    () => build({ dir }),
    (err) => {
      assert.match(err.message, /Unknown block/);
      assert.match(err.file, /b\.ms$/);
      return true;
    },
  );
});

test("cli one-letter aliases resolve to their long commands", () => {
  const dir = tmp();
  write(
    path.join(dir, "main.ms"),
    'sprite "S" { when greenFlag { looks.show(); } }',
  );

  const check = spawnSync(process.execPath, [bin, "c", dir], {
    encoding: "utf8",
  });
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /Checked 1 file\(s\): OK/);

  const built = spawnSync(
    process.execPath,
    [bin, "b", dir, "-o", path.join(dir, "out.sb3")],
    { encoding: "utf8" },
  );
  assert.equal(built.status, 0, built.stderr);
  assert.ok(fs.existsSync(path.join(dir, "out.sb3")));
  assert.match(built.stdout, /Built/);

  const catalog = spawnSync(process.execPath, [bin, "l"], { encoding: "utf8" });
  assert.equal(catalog.status, 0, catalog.stderr);
  assert.match(catalog.stdout, /MeowScript catalog/);
});

test("package.json exposes both the meowscript and ms executables", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  assert.equal(pkg.bin.meowscript, "bin/meowscript.js");
  assert.equal(pkg.bin.ms, "bin/meowscript.js");
});
