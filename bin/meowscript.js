#!/usr/bin/env node
/**
 * MeowScript command line interface.
 *
 *   meowscript build [input.ms | dir] [-o out.sb3] [--no-config]   (alias: b)
 *   meowscript decompile <input.sb3> [-o out.ms] [--assets <dir>]  (alias: d)
 *   meowscript check [input.ms | dir]                              (alias: c)
 *   meowscript catalog [--json]                                    (alias: l)
 *   meowscript init [dir]                                          (alias: i)
 *
 * `ms` is an alias for `meowscript`, so `ms c` runs `meowscript check`.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { build, writeSb3 } from "../src/build.js";
import { parse } from "../src/parser.js";
import { discoverSources } from "../src/project.js";
import { decompile } from "../src/decompiler.js";
import { unzipSync } from "../src/sb3.js";
import { CATALOG, blockNames } from "../src/catalog.js";
import { loadConfigFrom } from "../src/config.js";
import { loadExtensions } from "../src/extensions.js";

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const [key, inline] = token.slice(2).split("=");
      if (inline !== undefined) args.flags[key] = inline;
      else if (argv[i + 1] && !argv[i + 1].startsWith("-"))
        args.flags[key] = argv[++i];
      else args.flags[key] = true;
    } else if (token.startsWith("-")) {
      const key = token.slice(1);
      if (argv[i + 1] && !argv[i + 1].startsWith("-"))
        args.flags[key] = argv[++i];
      else args.flags[key] = true;
    } else {
      args._.push(token);
    }
  }
  return args;
}

function usage() {
  return `meowscript — compile MeowScript (.ms) to TurboWarp .sb3

Usage:
  meowscript build [<input.ms>|<dir>] [-o <output.sb3>] [--no-config]
  meowscript decompile <input.sb3> [-o <output.ms>] [--assets <dir>]
  meowscript check [<input.ms>|<dir>]
  meowscript catalog [--json]
  meowscript init [dir]

Commands:
  build     (b)  Compile a source file, or every .ms file in a directory
                 (defaults to the working directory) into one .sb3.
  decompile (d)  Convert an .sb3 back into MeowScript source.
  check     (c)  Parse a file (or every .ms file in a directory) for errors.
  catalog   (l)  List the available MeowScript blocks.
  init      (i)  Scaffold a new project.

Options:
  -o, --output    Output file path
  --no-config     Ignore meowscript.yml
  --assets <dir>  Extract sb3 assets into <dir> when decompiling
  --json          Machine readable output (catalog)

Note: \`ms\` is a shorthand for \`meowscript\` (e.g. \`ms b\`, \`ms c\`).
`;
}

/** Long command name -> one-letter alias. */
const COMMAND_ALIASES = {
  b: "build",
  d: "decompile",
  c: "check",
  l: "catalog",
  i: "init",
};

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function loadProjectExtensions(dir, config) {
  const catalog = {};
  const extensionUrls = {};
  if (!config.extensions || config.extensions.length === 0)
    return { catalog, extensionUrls };
  const loaded = await loadExtensions(config.extensions, { baseDir: dir });
  Object.assign(catalog, loaded.catalog);
  Object.assign(extensionUrls, loaded.extensionUrls);
  for (const warning of loaded.warnings)
    process.stderr.write(`warning: ${warning}\n`);
  return { catalog, extensionUrls };
}

/** Turn a project name into a filesystem-friendly slug. */
function slugify(name) {
  return (
    String(name || "project")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project"
  );
}

/** Split a positional build/check argument into `{file}` or `{dir}`. */
function resolveInput(input) {
  if (!input) return { dir: process.cwd() };
  const resolved = path.resolve(input);
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    fail(`error: input not found: ${input}`);
  }
  return stat.isDirectory() ? { dir: resolved } : { file: resolved };
}

async function cmdBuild(args) {
  const target = resolveInput(args._[0]);
  const searchDir = target.file ? path.dirname(target.file) : target.dir;

  const loaded = args.flags["no-config"]
    ? { project: null, path: null }
    : loadConfigFrom(searchDir);
  const config = loaded.project;
  const extBase = loaded.path ? path.dirname(loaded.path) : searchDir;
  const { catalog, extensionUrls } = await loadProjectExtensions(
    extBase,
    config || {},
  );

  const result = build({
    ...target,
    projectConfig: config,
    catalog,
    extensionUrls,
    useConfigFile: !args.flags["no-config"],
  });

  const explicit = args.flags.o || args.flags.output;
  const output =
    explicit ||
    (target.file
      ? target.file.replace(/\.ms$/i, ".sb3")
      : path.join(
          target.dir,
          "build",
          `${slugify(result.config.name || path.basename(target.dir))}.sb3`,
        ));

  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, result.sb3);

  const blockCount = result.project.targets.reduce(
    (sum, t) => sum + Object.keys(t.blocks).length,
    0,
  );
  process.stdout.write(
    `Built ${output}\n` +
      `  sources:    ${result.files.length} file(s)\n` +
      `  targets:    ${result.project.targets.length}\n` +
      `  blocks:     ${blockCount}\n` +
      `  assets:     ${result.assets.size}\n` +
      `  extensions: ${result.project.extensions.join(", ") || "(none)"}\n`,
  );
}

function cmdCheck(args) {
  const target = resolveInput(args._[0]);
  const files = target.file ? [target.file] : discoverSources(target.dir);
  if (files.length === 0)
    fail(`error: no .ms files found under ${target.dir}\n`);

  for (const file of files) {
    parse(fs.readFileSync(file, "utf8"), file);
  }
  process.stdout.write(`Checked ${files.length} file(s): OK\n`);
}

function cmdCatalog(args) {
  const names = blockNames();
  if (args.flags.json) {
    process.stdout.write(`${JSON.stringify(CATALOG, null, 2)}\n`);
    return;
  }
  process.stdout.write(`MeowScript catalog (${names.length} blocks):\n`);
  for (const name of names) {
    const entry = CATALOG[name];
    process.stdout.write(
      `  ${name.padEnd(32)} -> ${entry.opcode} [${entry.kind}]\n`,
    );
  }
}

function cmdDecompile(args) {
  const input = args._[0];
  if (!input)
    fail("error: decompile requires an input .sb3 file\n\n" + usage());
  const data = fs.readFileSync(input);
  const files = unzipSync(data);

  const assetDir = args.flags.assets;
  let assetPrefix = "";
  if (assetDir) {
    fs.mkdirSync(assetDir, { recursive: true });
    for (const [name, buffer] of files) {
      if (name === "project.json") continue;
      fs.writeFileSync(path.join(assetDir, name), buffer);
    }
    // Reference assets relative to the directory the .ms file will live in.
    const outDir = path.dirname(
      path.resolve(
        args.flags.o || args.flags.output || path.join(process.cwd(), "out.ms"),
      ),
    );
    const rel = path
      .relative(outDir, path.resolve(assetDir))
      .replace(/\\/g, "/");
    assetPrefix = rel ? `${rel}/` : "";
  }

  const source = decompile(data, { assetPrefix });
  const output = args.flags.o || args.flags.output;
  if (output) {
    fs.writeFileSync(output, source);
    process.stdout.write(`Decompiled ${input} -> ${output}\n`);
  } else {
    process.stdout.write(source);
  }
}

const INIT_FILES = {
  "meowscript.yml": `project:
  name: "My MeowScript Project"
  fps: 60
  width: 480
  height: 360
  turbo: false
  interpolation: true
`,
  "src/main.ms": `sprite "Cat" {
    costumes: {
        cat: "../assets/cat.svg"
    };

    let score = 0;

    when greenFlag {
        motion.goToXY(0, 0);
        control.forever {
            motion.turnRight(1);
        }
    }

    when keyPressed("space") {
        score += 1;
        looks.sayForSecs(operators.join("Score: ", score), 1);
    }
}
`,
  "assets/cat.svg": `<svg xmlns="http://www.w3.org/2000/svg" width="95" height="101" viewBox="0 0 95 101">
  <ellipse cx="47" cy="60" rx="35" ry="35" fill="#ffab19" stroke="#cf8b17" stroke-width="4"/>
  <circle cx="35" cy="50" r="6" fill="#000"/>
  <circle cx="60" cy="50" r="6" fill="#000"/>
</svg>
`,
};

function cmdInit(args) {
  const dir = args._[0] || ".";
  for (const [rel, content] of Object.entries(INIT_FILES)) {
    const dest = path.join(dir, rel);
    if (fs.existsSync(dest)) {
      process.stdout.write(`skip ${dest} (exists)\n`);
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
    process.stdout.write(`create ${dest}\n`);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const rawCommand = argv.shift();
  const command = COMMAND_ALIASES[rawCommand] || rawCommand;
  const args = parseArgs(argv);
  switch (command) {
    case "build":
      return cmdBuild(args);
    case "decompile":
      return cmdDecompile(args);
    case "check":
      return cmdCheck(args);
    case "catalog":
      return cmdCatalog(args);
    case "init":
      return cmdInit(args);
    case undefined:
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(usage());
      return;
    default:
      fail(`error: unknown command ${JSON.stringify(command)}\n\n${usage()}`);
  }
}

main().catch((err) => {
  if (err && typeof err.format === "function")
    process.stderr.write(`${err.format()}\n`);
  else process.stderr.write(`error: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
