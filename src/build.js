/**
 * High level build pipeline: `.ms` source(s) + `meowscript.yml` -> `.pmp` bytes.
 */
import fs from "node:fs";
import path from "node:path";
import { parse } from "./parser.js";
import { mergePrograms, discoverSources } from "./project.js";
import { Compiler } from "./compiler.js";
import { zipSync } from "./sb3.js";
import { loadConfigFrom, DEFAULT_PROJECT } from "./config.js";

/**
 * @typedef {object} BuildOptions
 * @property {string} [source] MeowScript source text.
 * @property {string} [file] Path of a single source file.
 * @property {string[]} [files] Paths of several source files.
 * @property {Array<{file: string, source: string}>} [sources] Pre-read sources.
 * @property {string} [dir] Directory to scan for `.ms` files when no input is given.
 * @property {object} [projectConfig] Explicit project config (overrides meowscript.yml).
 * @property {string} [configDir] Directory to start the meowscript.yml search from.
 * @property {Record<string, object>} [catalog] Extra catalog entries.
 * @property {Record<string, string>} [extensionUrls] Extension id -> URL map.
 * @property {boolean} [useConfigFile] Whether to auto-load meowscript.yml (default true).
 */

/**
 * Resolve the list of source files (and their text) to compile.
 * @param {BuildOptions} options
 * @returns {{dir: string, entries: Array<{file: string, source: string}>}}
 */
function resolveSources(options) {
  const cwd = process.cwd();

  if (Array.isArray(options.sources)) {
    const dir = path.resolve(options.dir || cwd);
    const entries = options.sources.map((entry) => {
      if (typeof entry === "string") {
        const file = path.resolve(entry);
        return { file, source: fs.readFileSync(file, "utf8") };
      }
      const file = path.resolve(entry.file || path.join(dir, "input.ms"));
      return { file, source: entry.source };
    });
    return { dir, entries };
  }

  if (options.source != null) {
    const file = options.file
      ? path.resolve(options.file)
      : path.join(path.resolve(options.dir || cwd), "input.ms");
    return {
      dir: options.dir ? path.resolve(options.dir) : path.dirname(file),
      entries: [{ file, source: options.source }],
    };
  }

  if (Array.isArray(options.files) && options.files.length > 0) {
    const files = options.files.map((f) => path.resolve(f));
    const dir = options.dir
      ? path.resolve(options.dir)
      : path.dirname(files[0]);
    return {
      dir,
      entries: files.map((file) => ({
        file,
        source: fs.readFileSync(file, "utf8"),
      })),
    };
  }

  if (options.file) {
    const file = path.resolve(options.file);
    return {
      dir: path.dirname(file),
      entries: [{ file, source: fs.readFileSync(file, "utf8") }],
    };
  }

  const dir = path.resolve(options.dir || cwd);
  const files = discoverSources(dir);
  if (files.length === 0) throw new Error(`No .ms files found under ${dir}`);
  return {
    dir,
    entries: files.map((file) => ({
      file,
      source: fs.readFileSync(file, "utf8"),
    })),
  };
}

/**
 * @param {BuildOptions} [options]
 * @returns {{project: object, assets: Map<string, Buffer>, sb3: Buffer, config: object, ast: object, files: string[]}}
 */
export function build(options = {}) {
  const { dir, entries } = resolveSources(options);
  if (entries.length === 0) throw new Error("No MeowScript sources to compile");

  let projectConfig = options.projectConfig || null;
  let configPath = null;
  if (!projectConfig && options.useConfigFile !== false) {
    const loaded = loadConfigFrom(options.configDir || dir);
    projectConfig = loaded.project;
    configPath = loaded.path;
  }
  if (!projectConfig) projectConfig = { ...DEFAULT_PROJECT };

  const asts = entries.map(({ file, source }) => ({
    ast: parse(source, file),
    file,
  }));
  const ast = mergePrograms(asts);

  // Assets are resolved relative to the file that references them, falling
  // back to the config directory (or the scanned directory) for inline
  // sources that have no path of their own.
  const baseDir = configPath ? path.dirname(configPath) : dir;
  const loadAsset = (assetPath, loc) => {
    const from = loc && loc.file ? path.dirname(loc.file) : baseDir;
    const resolved = path.isAbsolute(assetPath)
      ? assetPath
      : path.resolve(from, assetPath);
    return fs.readFileSync(resolved);
  };

  const compiler = new Compiler({
    project: projectConfig,
    loadAsset,
    catalog: options.catalog,
    extensionUrls: options.extensionUrls,
    file: entries[0].file,
  });
  const { project, assets } = compiler.compile(ast);

  const sb3 = writeSb3(project, assets);
  return {
    project,
    assets,
    sb3,
    config: projectConfig,
    ast,
    files: entries.map((e) => e.file),
  };
}

/**
 * Serialize project JSON + assets into a `.pmp` ZIP buffer.
 *
 * PenguinMod's `.pmp` files are byte-for-byte the same Scratch 3 archive as
 * `.sb3`, so this is also what {@link writeSb3} produces.
 * @param {object} project
 * @param {Map<string, Buffer>} assets
 * @returns {Buffer}
 */
export function writeSb3(project, assets) {
  const files = [
    {
      name: "project.json",
      data: Buffer.from(JSON.stringify(project)),
    },
  ];
  for (const [md5ext, buffer] of assets) {
    files.push({ name: md5ext, data: buffer });
  }
  return zipSync(files);
}
