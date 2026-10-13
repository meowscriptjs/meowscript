import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { spawnSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { discoverSources, mergePrograms } from "../src/project.js";
import { build } from "../src/build.js";
import { parse } from "../src/parser.js";
import { ParseError, CompileError } from "../src/errors.js";
import { zipSync } from "../src/sb3.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "meowscript.js");
const execFileAsync = promisify(execFile);

// A minimal extension that is loaded from a URL in the catalog test below.
const SIGNALS_EXT = `
(function (Scratch) {
  'use strict';
  class Signals {
    getInfo () {
      return {
        id: 'signals',
        name: 'Signals',
        blocks: [
          {opcode: 'send', blockType: Scratch.BlockType.COMMAND, text: 'send [MSG]',
           arguments: {MSG: {type: Scratch.ArgumentType.STRING, defaultValue: 'hi'}}}
        ]
      };
    }
    send () {}
  }
  Scratch.extensions.register(new Signals());
})(Scratch);
`;

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

  const built = spawnSync(process.execPath, [bin, "b", dir], {
    encoding: "utf8",
  });
  assert.equal(built.status, 0, built.stderr);
  // The default output for a directory is build/<slug>.pmp.
  const defaultOut = path.join(dir, "build", "meowscript-project.pmp");
  assert.ok(fs.existsSync(defaultOut), "expected build/meowscript-project.pmp");
  assert.ok(
    !fs.existsSync(path.join(dir, "build", "meowscript-project.sb3")),
    "build output should not use the .sb3 extension",
  );
  assert.match(built.stdout, /Built/);

  const catalog = spawnSync(process.execPath, [bin, "l"], { encoding: "utf8" });
  assert.equal(catalog.status, 0, catalog.stderr);
  assert.match(catalog.stdout, /MeowScript catalog/);
});

test("building a single file defaults to a .pmp next to the source", () => {
  const dir = tmp();
  const source = path.join(dir, "game.ms");
  write(source, 'sprite "S" { when greenFlag { looks.show(); } }');

  const built = spawnSync(process.execPath, [bin, "b", source], {
    encoding: "utf8",
  });
  assert.equal(built.status, 0, built.stderr);
  assert.ok(fs.existsSync(path.join(dir, "game.pmp")));
  assert.ok(!fs.existsSync(path.join(dir, "game.sb3")));
});

test("boolean CLI flags leave the following input positional", () => {
  const dir = tmp();
  const source = path.join(dir, "game.source");
  write(source, 'sprite "S" { when greenFlag { looks.show(); } }');
  for (const flag of ["--no-config", "--json", "--help", "-h", "--h"]) {
    const checked = spawnSync(process.execPath, [bin, "c", flag, source], {
      cwd: dir,
      encoding: "utf8",
    });
    assert.equal(checked.status, 0, checked.stderr);
    assert.match(checked.stdout, /Checked 1 file/);
  }
  const output = path.join(dir, "explicit.pmp");
  const built = spawnSync(
    process.execPath,
    [bin, "b", "--no-config", source, `--output=${output}`],
    {
      cwd: dir,
      encoding: "utf8",
    },
  );
  assert.equal(built.status, 0, built.stderr);
  assert.ok(fs.existsSync(output));
});

test("building sources without .ms appends .pmp and preserves the source", () => {
  const dir = tmp();
  const content = 'sprite "S" { when greenFlag { looks.show(); } }';
  for (const name of ["game", "game.txt", "game.MS"]) {
    const source = path.join(dir, name);
    write(source, content);
    const built = spawnSync(process.execPath, [bin, "b", source], {
      encoding: "utf8",
    });
    assert.equal(built.status, 0, built.stderr);
    assert.equal(fs.readFileSync(source, "utf8"), content);
    const output = name.endsWith(".MS") ? "game.pmp" : `${name}.pmp`;
    assert.ok(fs.existsSync(path.join(dir, output)));
  }
});

test("decompile extracts only flat asset names and skips symlinks", () => {
  const dir = tmp();
  const assetDir = path.join(dir, "assets");
  const assetName = `${"a".repeat(32)}.svg`;
  const linkName = `${"b".repeat(32)}.wav`;
  const outside = path.join(dir, "outside.wav");
  write(outside, "original");
  fs.mkdirSync(assetDir);
  fs.symlinkSync(outside, path.join(assetDir, linkName));
  const unsafeNames = [
    "../outside.wav",
    outside,
    "..\\outside.wav",
    `nested/${assetName}`,
    "wrong.svg",
    `${"a".repeat(31)}.svg`,
    `${assetName}/..`,
    `${assetName}\n`,
  ];
  const { project } = build({ source: 'sprite "S" {}', useConfigFile: false });
  const input = path.join(dir, "input.pmp");
  fs.writeFileSync(
    input,
    zipSync([
      { name: "project.json", data: Buffer.from(JSON.stringify(project)) },
      ...[assetName, linkName, ...unsafeNames].map((name) => ({
        name,
        data: Buffer.from("asset"),
      })),
    ]),
  );
  const output = path.join(dir, "out.ms");
  const result = spawnSync(
    process.execPath,
    [bin, "d", input, "--assets", assetDir, "-o", output],
    {
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    fs.readFileSync(path.join(assetDir, assetName), "utf8"),
    "asset",
  );
  assert.equal(fs.readFileSync(outside, "utf8"), "original");
  assert.deepEqual(fs.readdirSync(assetDir).sort(), [assetName, linkName]);
  assert.ok(fs.existsSync(output));
});

test("catalog lists blocks from extensions loaded over a URL", async () => {
  const dir = tmp();
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "text/javascript");
    res.end(SIGNALS_EXT);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    write(
      path.join(dir, "meowscript.yml"),
      `project:\n  name: "Cat"\n  extensions:\n    - "http://127.0.0.1:${port}/signals.js"\n`,
    );
    write(
      path.join(dir, "main.ms"),
      'sprite "S" { when greenFlag { signals.send("hi"); } }',
    );

    const listed = await execFileAsync(process.execPath, [bin, "l"], {
      cwd: dir,
    });
    assert.match(
      listed.stdout,
      /signals\.send\s+-> signals_send \[command\] \(ext signals\)/,
    );
    assert.match(listed.stdout, /from extensions\)/);

    const json = await execFileAsync(
      process.execPath,
      [bin, "l", "--json", dir],
      {
        cwd: root,
      },
    );
    const catalog = JSON.parse(json.stdout);
    assert.equal(catalog["signals.send"].opcode, "signals_send");
    assert.equal(catalog["motion.moveSteps"].opcode, "motion_movesteps");

    // The same extension blocks still compile against the URL source.
    const built = await execFileAsync(
      process.execPath,
      [bin, "b", "-o", path.join(dir, "out.pmp")],
      { cwd: dir },
    );
    assert.match(built.stdout, /extensions: signals/);
  } finally {
    server.close();
  }
});

test("catalog lists local extensions without the build-only URL warning", async () => {
  const dir = tmp();
  write(path.join(dir, "signals.js"), SIGNALS_EXT);
  write(
    path.join(dir, "meowscript.yml"),
    'project:\n  name: "Cat"\n  extensions:\n    - "./signals.js"\n',
  );

  const listed = await execFileAsync(process.execPath, [bin, "l", dir], {
    cwd: dir,
  });
  assert.match(listed.stdout, /signals\.send\s+-> signals_send/);
  assert.doesNotMatch(listed.stderr, /extensionURLs/);
});

test("package.json exposes both the meowscript and ms executables", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  assert.equal(pkg.bin.meowscript, "bin/meowscript.js");
  assert.equal(pkg.bin.ms, "bin/meowscript.js");
});
