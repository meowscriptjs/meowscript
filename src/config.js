/**
 * `meowscript.yml` project configuration and TurboWarp `_twconfig_` emission.
 *
 * TurboWarp stores per-project runtime settings (framerate, stage size, turbo,
 * interpolation, ...) inside a stage comment whose final line ends with the
 * magic string ` // _twconfig_` followed by extended JSON. We reproduce that
 * format exactly so the settings round-trip through TurboWarp's own loader.
 */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

export const DEFAULT_PROJECT = {
  name: "MeowScript Project",
  framerate: 30,
  width: 480,
  height: 360,
  turbo: false,
  interpolation: false,
  hq: false,
  runtime: {},
  extensions: [],
};

export const TW_CONFIG_MAGIC = " // _twconfig_";

const TW_COMMENT_PREAMBLE =
  "Configuration for https://turbowarp.org/\n" +
  "You can move, resize, minimize this comment, but don't edit it by hand. " +
  "This comment can be deleted to remove the stored settings.";

/**
 * @param {object} raw parsed YAML `project` mapping
 * @returns {typeof DEFAULT_PROJECT}
 */
export function normalizeProject(raw = {}) {
  const project = { ...DEFAULT_PROJECT };

  if (raw.name != null) project.name = String(raw.name);
  if (raw.fps != null) project.framerate = Number(raw.fps);
  else if (raw.framerate != null) project.framerate = Number(raw.framerate);
  if (raw.width != null) project.width = Number(raw.width);
  if (raw.height != null) project.height = Number(raw.height);
  if (raw.turbo != null) project.turbo = Boolean(raw.turbo);
  if (raw.interpolation != null)
    project.interpolation = Boolean(raw.interpolation);
  else if (raw.interpolate != null)
    project.interpolation = Boolean(raw.interpolate);
  if (raw.hq != null || raw.hqPen != null)
    project.hq = Boolean(raw.hq ?? raw.hqPen);
  if (raw.runtime && typeof raw.runtime === "object")
    project.runtime = raw.runtime;
  if (Array.isArray(raw.extensions))
    project.extensions = raw.extensions.map(String);

  return project;
}

/**
 * Parse a YAML config string.
 * @param {string} text
 * @returns {{project: typeof DEFAULT_PROJECT, raw: object}}
 */
export function parseConfig(text) {
  const raw = yaml.load(text) || {};
  if (typeof raw !== "object")
    throw new Error("meowscript.yml must contain a mapping at the top level");
  return { project: normalizeProject(raw.project || {}), raw };
}

/**
 * Find the nearest `meowscript.yml`/`meowscript.yaml`, walking up from `dir`.
 * This lets a project keep its config at the repository root while sources
 * live in `src/`.
 * @param {string} dir
 * @returns {string|null}
 */
export function findConfigPath(dir) {
  let current = path.resolve(dir);
  for (;;) {
    for (const name of ["meowscript.yml", "meowscript.yaml"]) {
      const candidate = path.join(current, name);
      if (fs.existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Find and load `meowscript.yml`/`meowscript.yaml` from a directory (or any of
 * its ancestors).
 * @param {string} dir
 * @returns {{project: typeof DEFAULT_PROJECT, raw: object, path: string|null}}
 */
export function loadConfigFrom(dir) {
  const found = findConfigPath(dir);
  if (found) {
    const { project, raw } = parseConfig(fs.readFileSync(found, "utf8"));
    return { project, raw, path: found };
  }
  return { project: { ...DEFAULT_PROJECT }, raw: {}, path: null };
}

/**
 * Build the differing-from-default `_twconfig_` payload payload. Matches the
 * shape produced by `runtime.storeProjectOptions()`.
 * @param {typeof DEFAULT_PROJECT} project
 * @returns {object}
 */
export function twConfigPayload(project) {
  const out = {};
  if (project.framerate && project.framerate !== DEFAULT_PROJECT.framerate)
    out.framerate = project.framerate;
  if (project.turbo) out.turbo = true;
  if (project.interpolation) out.interpolation = true;
  if (project.hq) out.hq = true;
  if (project.width && project.width !== DEFAULT_PROJECT.width)
    out.width = project.width;
  if (project.height && project.height !== DEFAULT_PROJECT.height)
    out.height = project.height;

  const defaultRuntime = { maxClones: 300, miscLimits: true, fencing: true };
  const runtime = {};
  for (const [key, value] of Object.entries(project.runtime || {})) {
    if (value !== defaultRuntime[key]) runtime[key] = value;
  }
  if (Object.keys(runtime).length) out.runtimeOptions = runtime;

  return out;
}

/**
 * Full text for the stage `_twconfig_` comment, or null when everything is at
 * its default.
 * @param {typeof DEFAULT_PROJECT} project
 * @returns {string|null}
 */
export function twConfigComment(project) {
  const payload = twConfigPayload(project);
  if (Object.keys(payload).length === 0) return null;
  return `${TW_COMMENT_PREAMBLE}\n${JSON.stringify(payload)}${TW_CONFIG_MAGIC}`;
}
