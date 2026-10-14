/**
 * Multi-file project assembly.
 *
 * A MeowScript project can be spread across any number of `.ms` files in a
 * directory tree. This module discovers those files and merges their ASTs into
 * a single `Program`, so the rest of the pipeline keeps working with one AST.
 */
import fs from "node:fs";
import path from "node:path";
import { ParseError } from "./errors.js";

/** Directories never scanned for `.ms` sources. */
const IGNORED_DIRS = new Set([
  "node_modules",
  "build",
  "dist",
  "coverage",
  ".cache",
]);

/**
 * Recursively find every `.ms` file under `dir`, skipping hidden entries and
 * well-known build/dependency directories. Results are deterministic (sorted by
 * path) so builds are reproducible.
 * @param {string} dir
 * @returns {string[]} absolute file paths
 */
export function discoverSources(dir) {
  const root = path.resolve(dir);
  const found = [];

  const walk = (current) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        walk(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".ms")) {
        found.push(full);
      }
    }
  };

  walk(root);
  return found.sort();
}

/** @param {object} loc */
function errorInfo(loc) {
  return {
    file: loc && loc.file,
    line: loc && loc.line,
    column: loc && loc.column,
  };
}

/**
 * Merge parsed programs into a single project AST.
 *
 * - At most one `stage { }` declaration is allowed across all files.
 * - Top-level statements from every file become stage content.
 * - Sprite names must be unique across the whole project.
 *
 * @param {Array<{ast: object, file: string}>} entries
 * @returns {object} a `Program` node
 */
export function mergePrograms(entries) {
  let stage = null;
  const sprites = [];
  const topItems = [];
  const spriteFiles = new Map();

  for (const { ast, file } of entries) {
    if (ast.stage) {
      if (stage) {
        throw new ParseError(
          "A project may only declare one stage",
          errorInfo(ast.stage.loc),
        );
      }
      stage = ast.stage;
    }
    topItems.push(...ast.topItems);
    for (const sprite of ast.sprites) {
      if (spriteFiles.has(sprite.name)) {
        const first = spriteFiles.get(sprite.name);
        throw new ParseError(
          `Duplicate sprite ${JSON.stringify(sprite.name)} (declared in ${first} and ${file})`,
          errorInfo(sprite.loc),
        );
      }
      spriteFiles.set(sprite.name, file);
      sprites.push(sprite);
    }
  }

  return { type: "Program", stage, sprites, topItems };
}
