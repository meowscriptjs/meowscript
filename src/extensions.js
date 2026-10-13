/**
 * PenguinMod extension bindings.
 *
 * MeowScript keeps its catalog centralized, so third-party extensions are
 * supported by *synthesizing* catalog entries at build time: the extension
 * source is evaluated in a minimal `node:vm` sandbox that shims the
 * `Scratch.*` API it expects, then `getInfo()` is read back and translated into
 * the same descriptor shape used by `catalog.js`.
 *
 * A MeowScript call `myExtension.myBlock(...)` maps onto the runtime opcode
 * `myExtension_myBlock`, exactly how scratch-vm names extension blocks.
 *
 * Extension sources are untrusted: they run with no filesystem, network or
 * `process` access. Remote sources are fetched with the global `fetch`.
 *
 * Many PenguinMod gallery extensions refuse to load unless they run
 * *unsandboxed* (`if (!Scratch.extensions.unsandboxed) throw ...`). Whether an
 * extension actually runs sandboxed is decided by the editor (or packager), not
 * by us, so compilation must not be the thing that blocks them: when a sandboxed
 * evaluation throws we retry with an unsandboxed `Scratch` API. Extensions that
 * only load that way are reported as `unsandboxed` so the CLI can warn that they
 * must be allowed to run unsandboxed when the project is opened.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

/** `Scratch.BlockType` (values used by scratch-vm / PenguinMod). */
export const BlockType = {
  BOOLEAN: "Boolean",
  BUTTON: "button",
  LABEL: "label",
  COMMAND: "command",
  CONDITIONAL: "conditional",
  EVENT: "event",
  HAT: "hat",
  LOOP: "loop",
  REPORTER: "reporter",
  XML: "xml",
};

/** `Scratch.ArgumentType`. */
export const ArgumentType = {
  ANGLE: "angle",
  BOOLEAN: "Boolean",
  COLOR: "color",
  NUMBER: "number",
  STRING: "string",
  MATRIX: "matrix",
  NOTE: "note",
  IMAGE: "image",
  POLYGON: "polygon",
  CUSTOM: "custom",
  COSTUME: "costume",
  SOUND: "sound",
  VARIABLE: "variable",
  LIST: "list",
  BROADCAST: "broadcast",
  SEPERATOR: "seperator",
};

/** `Scratch.ArgumentAlignment`. */
export const ArgumentAlignment = {
  DEFAULT: null,
  LEFT: "LEFT",
  CENTER: "CENTRE",
  RIGHT: "RIGHT",
};

/** `Scratch.BlockShape` (PenguinMod's richer value types). */
export const BlockShape = {
  HEXAGONAL: 1,
  ROUND: 2,
  SQUARE: 3,
  LEAF: 4,
  PLUS: 5,
  OCTAGONAL: 6,
  BUMPED: 7,
  INDENTED: 8,
  SCRAPPED: 9,
  ARROW: 10,
  TICKET: 11,
};

/** `Scratch.NotchShape`. */
export const NotchShape = {
  SWITCH: "switchCase",
  HEXAGON: "hexagon",
  ROUND: "round",
  SQUARE: "square",
  LEAF: "leaf",
  PLUS: "plus",
  OCTAGONAL: "octagonal",
  BUMPED: "bumped",
  INDENTED: "indented",
  SCRAPPED: "scrapped",
  ARROW: "arrow",
  TICKET: "ticket",
  JIGSAW: "jigsaw",
  INVERTED: "inverted",
  PINCER: "pincer",
};

/** `Scratch.TargetType`. */
export const TargetType = {
  SPRITE: "sprite",
  STAGE: "stage",
};

/** `Scratch.Clone`. */
export const Clone = {
  simple: (original) => JSON.parse(JSON.stringify(original)),
};

/** `Scratch.Color`. */
export const Color = {
  get RGB_BLACK() {
    return { r: 0, g: 0, b: 0 };
  },
  get RGB_WHITE() {
    return { r: 255, g: 255, b: 255 };
  },
  decimalToHex(decimal) {
    let value = decimal;
    if (value < 0) value += 0xffffff + 1;
    let hex = Math.round(Number(value)).toString(16);
    hex = `#${"000000".slice(0, 6 - hex.length)}${hex}`;
    return hex;
  },
  decimalToRgb(decimal) {
    const a = (decimal >> 24) & 0xff;
    return {
      r: (decimal >> 16) & 0xff,
      g: (decimal >> 8) & 0xff,
      b: decimal & 0xff,
      a: a > 0 ? a : 255,
    };
  },
  hexToRgb(hex) {
    let value = hex;
    if (value.startsWith("#")) value = value.slice(1);
    if (value.length === 8) value = value.slice(0, 6);
    const parsed = parseInt(value, 16);
    if (Number.isNaN(parsed)) return null;
    if (value.length === 6)
      return {
        r: (parsed >> 16) & 0xff,
        g: (parsed >> 8) & 0xff,
        b: parsed & 0xff,
      };
    if (value.length === 3) {
      const r = (parsed >> 8) & 0xf;
      const g = (parsed >> 4) & 0xf;
      const b = parsed & 0xf;
      return { r: (r << 4) | r, g: (g << 4) | g, b: (b << 4) | b };
    }
    return null;
  },
  rgbToHex(rgb) {
    return Color.decimalToHex(Color.rgbToDecimal(rgb));
  },
  rgbToDecimal(rgb) {
    return (rgb.r << 16) + (rgb.g << 8) + rgb.b;
  },
  hexToDecimal(hex) {
    return Color.rgbToDecimal(Color.hexToRgb(hex));
  },
};

/** `Scratch.Cast`. */
export const Cast = {
  toString: (value) => String(value),
  toNumber: (value) => {
    const n = Number(value);
    return Number.isNaN(n) ? 0 : n;
  },
  toBoolean: (value) =>
    typeof value === "boolean" ? value : String(value) === "true",
  toList: (value) => (Array.isArray(value) ? value : [value]),
};

// -------------------------------------------------------------- translation

/**
 * Map a `Scratch.ArgumentType` onto a MeowScript input descriptor.
 * @param {object} arg
 * @returns {{type: string}}
 */
function argumentSpec(arg) {
  const type = arg && arg.type;
  switch (type) {
    case ArgumentType.BOOLEAN:
      return { type: "boolean" };
    case ArgumentType.NUMBER:
      return { type: "number" };
    case ArgumentType.ANGLE:
      return { type: "angle" };
    case ArgumentType.COLOR:
      return { type: "color" };
    // Matrix, note, costume, backdrop, sound and string all travel as text.
    default:
      return { type: "string" };
  }
}

/**
 * @param {string} blockType
 * @returns {'command'|'reporter'|'boolean'|'hat'|null} null for non-block types
 */
function blockKind(blockType) {
  switch (blockType) {
    case BlockType.BOOLEAN:
      return "boolean";
    case BlockType.REPORTER:
      return "reporter";
    case BlockType.HAT:
    case BlockType.EVENT:
      return "hat";
    case BlockType.LABEL:
    case BlockType.BUTTON:
    case BlockType.XML:
      return null;
    default:
      return "command";
  }
}

/** Flatten the (possibly nested) `blocks` array from `getInfo()`. */
function flattenBlocks(blocks, out = []) {
  for (const block of blocks || []) {
    if (Array.isArray(block)) flattenBlocks(block, out);
    else if (
      block &&
      typeof block === "object" &&
      typeof block.opcode === "string"
    )
      out.push(block);
  }
  return out;
}

/**
 * Turn one extension `getInfo()` result into catalog entries.
 * @param {Record<string, object>} catalog
 * @param {object} info
 * @param {string} sourceName
 * @returns {number} number of blocks registered
 */
function registerInfo(catalog, info, sourceName) {
  if (!info || typeof info !== "object" || typeof info.id !== "string") {
    throw new Error(
      `extension ${sourceName} did not provide a getInfo() with a string id`,
    );
  }
  const id = info.id;
  let count = 0;
  for (const block of flattenBlocks(info.blocks)) {
    const kind = blockKind(block.blockType);
    if (kind == null) continue;

    const inputs = {};
    for (const [name, arg] of Object.entries(block.arguments || {})) {
      inputs[name] = argumentSpec(arg);
    }

    const entry = {
      opcode: `${id}_${block.opcode}`,
      kind,
      inputs,
      extension: id,
    };
    if (kind === "hat") {
      entry.args = Object.entries(block.arguments || {}).map(([name, arg]) => ({
        input: name,
        type: argumentSpec(arg).type,
      }));
    } else if (
      block.blockType === BlockType.CONDITIONAL ||
      block.blockType === BlockType.LOOP
    ) {
      inputs.SUBSTACK = { type: "substack" };
      if ((block.branchCount || 1) > 1) inputs.SUBSTACK2 = { type: "substack" };
    }

    catalog[`${id}.${block.opcode}`] = entry;
    count += 1;
  }
  return count;
}

// ------------------------------------------------------------------ sandbox

/**
 * A permissive stand-in for a runtime object.
 *
 * Extensions routinely touch the VM at module scope — `Scratch.vm.runtime.on(…)`,
 * `vm.runtime.registerSerializer(…)`, `Scratch.renderer.…` — none of which is
 * needed to read `getInfo()`. Instead of throwing on a missing browser/VM
 * global, hand back an object that tolerates arbitrary reads, writes and calls.
 * @param {string} label human-readable name, used for `toString`/coercion
 * @returns {any}
 */
function permissive(label) {
  const cache = new Map();
  const fn = function () {
    return proxy;
  };
  const proxy = new Proxy(fn, {
    get(target, prop) {
      if (prop === "then") return undefined; // stay non-thenable
      if (prop === Symbol.toPrimitive) return () => label;
      if (prop === "toString" || prop === "valueOf" || prop === "toJSON")
        return () => label;
      if (typeof prop === "symbol") return target[prop];
      if (!cache.has(prop)) cache.set(prop, permissive(`${label}.${prop}`));
      return cache.get(prop);
    },
    set() {
      return true;
    },
    has() {
      return true;
    },
    apply() {
      return proxy;
    },
    construct() {
      return proxy;
    },
  });
  return proxy;
}

function makeSandbox(registered, { unsandboxed = false } = {}) {
  const Scratch = {
    extensions: {
      register(extension) {
        registered.push(extension);
      },
      // PenguinMod sets `unsandboxed: true` for unsandboxed loads and exposes
      // `isPenguinMod`, so extensions can adapt to whichever loader runs them.
      unsandboxed: Boolean(unsandboxed),
      isPenguinMod: true,
    },
    BlockType,
    ArgumentType,
    ArgumentAlignment,
    BlockShape,
    NotchShape,
    TargetType,
    Clone,
    Color,
    Cast,
    translate: (value) => {
      if (typeof value === "string") return value;
      if (
        value &&
        typeof value === "object" &&
        typeof value.default === "string"
      )
        return value.default;
      return value == null ? "" : String(value);
    },
    canFetch: () => Promise.resolve(false),
    fetch: () =>
      Promise.reject(
        new Error("Scratch.fetch is not available while compiling"),
      ),
    canOpenWindow: () => Promise.resolve(false),
    openWindow: () =>
      Promise.reject(
        new Error("Scratch.openWindow is not available while compiling"),
      ),
    canRedirect: () => Promise.resolve(false),
    redirect: () =>
      Promise.reject(
        new Error("Scratch.redirect is not available while compiling"),
      ),
    canRecordAudio: () => Promise.resolve(false),
    canRecordVideo: () => Promise.resolve(false),
    canReadClipboard: () => Promise.resolve(false),
    canNotify: () => Promise.resolve(false),
    canGeolocate: () => Promise.resolve(false),
    canEmbed: () => Promise.resolve(false),
    // The editor lets the user allow/decline unsandboxing; mirror that here so
    // metadata extraction can see the API the extension is written against.
    canUnsandbox: () => Promise.resolve(Boolean(unsandboxed)),
    canScreenshotCamera: () => Promise.resolve(false),
    canDownload: () => Promise.resolve(false),
    download: () =>
      Promise.reject(
        new Error("Scratch.download is not available while compiling"),
      ),
    vm: permissive("Scratch.vm"),
    renderer: permissive("Scratch.renderer"),
    gui: permissive("Scratch.gui"),
    // Some extensions probe these at module scope.
    runtime: permissive("Scratch.runtime"),
    stage: permissive("Scratch.stage"),
  };

  const sandbox = {
    Scratch,
    ScratchExtensions: {
      register() {
        /* legacy ScratchX extensions unsupported */
      },
    },
    console,
    // Metadata extraction is synchronous and extension timers must never fire:
    // they would outlive the sandbox and could hold the CLI process open.
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    Math,
    Date,
    JSON,
  };
  // Browser globals unsandboxed extensions touch at module scope. None of them
  // need to do anything to read `getInfo()`; they exist so setup code does not
  // throw. The sandbox has no network, filesystem or real DOM access.
  sandbox.vm = permissive("vm");
  sandbox.document = permissive("document");
  sandbox.navigator = permissive("navigator");
  sandbox.location = permissive("location");
  sandbox.localStorage = permissive("localStorage");
  // NB: `alert` is deliberately left undefined. Extensions use it inside their
  // unsandboxed guard (`if (!Scratch.extensions.unsandboxed) { alert(...); return; }`),
  // so a permissive alert would let the sandboxed probe "succeed" without
  // registering anything and skip the unsandboxed retry.
  sandbox.Audio = permissive("Audio");
  sandbox.Image = permissive("Image");
  sandbox.requestAnimationFrame = permissive("requestAnimationFrame");
  sandbox.cancelAnimationFrame = permissive("cancelAnimationFrame");

  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  return sandbox;
}

/** Evaluate extension source and return the `getInfo()` results. */
function evaluateExtension(source, filename, { unsandboxed = false } = {}) {
  const registered = [];
  const context = vm.createContext(makeSandbox(registered, { unsandboxed }));
  const script = new vm.Script(source, { filename });
  script.runInContext(context, { timeout: 5000 });

  const infos = [];
  for (const extension of registered) {
    if (!extension) continue;
    if (typeof extension.getInfo === "function")
      infos.push(extension.getInfo());
    else infos.push(extension);
  }
  return infos;
}

// ------------------------------------------------------------------- loading

/** Resolve a config entry to source text. */
async function resolveSource(entry, baseDir, fetchImpl) {
  const value = String(entry);
  if (/^https?:\/\//i.test(value)) {
    const fetchFn = fetchImpl || globalThis.fetch;
    if (typeof fetchFn !== "function")
      throw new Error("global fetch is unavailable; pass fetchImpl");
    const response = await fetchFn(value);
    if (!response.ok)
      throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    return { source: await response.text(), remote: true, url: value };
  }
  const resolved = path.isAbsolute(value)
    ? value
    : path.resolve(baseDir, value);
  return {
    source: fs.readFileSync(resolved, "utf8"),
    remote: false,
    url: value,
    file: resolved,
  };
}

/**
 * Evaluate extension source, retrying unsandboxed when the sandboxed pass
 * throws. Extensions that guard on `Scratch.extensions.unsandboxed` can only be
 * loaded that way, and it is the editor (or packager) that decides it.
 * @param {string} source
 * @param {string} filename
 * @returns {{infos: object[], unsandboxed: boolean}}
 */
function evaluateExtensionAny(source, filename) {
  try {
    return {
      infos: evaluateExtension(source, filename, { unsandboxed: false }),
      unsandboxed: false,
    };
  } catch (sandboxedError) {
    try {
      return {
        infos: evaluateExtension(source, filename, { unsandboxed: true }),
        unsandboxed: true,
      };
    } catch (unsandboxedError) {
      const sandboxedMessage = sandboxedError && sandboxedError.message;
      const unsandboxedMessage = unsandboxedError && unsandboxedError.message;
      // Neither mode works. Prefer the unsandboxed failure (the sandboxed one is
      // usually just the extension's own guard) and keep both when they differ.
      if (unsandboxedMessage && unsandboxedMessage !== sandboxedMessage) {
        throw new Error(
          `${unsandboxedMessage} (sandboxed: ${sandboxedMessage})`,
          { cause: unsandboxedError },
        );
      }
      throw unsandboxedError;
    }
  }
}

/**
 * Load a list of extension references.
 *
 * @param {Array<string>} list Paths or `http(s)://` URLs.
 * @param {{baseDir?: string, fetchImpl?: typeof fetch, expectUnsandboxed?: string|string[], localFileWarning?: boolean}} [options]
 *   `expectUnsandboxed` acknowledges extensions that are known to require
 *   unsandboxed mode, silencing the warning for them. `localFileWarning`
 *   (default true) emits the build-specific notice that local files are not
 *   recorded in `extensionURLs`; listing commands turn it off.
 * @returns {Promise<{catalog: Record<string, object>, extensionUrls: Record<string, string>, warnings: string[], ids: string[], unsandboxed: string[]}>}
 *   `unsandboxed` holds the ids of extensions that only load unsandboxed.
 */
export async function loadExtensions(
  list,
  {
    baseDir = process.cwd(),
    fetchImpl,
    expectUnsandboxed = [],
    localFileWarning = true,
  } = {},
) {
  const catalog = {};
  const extensionUrls = {};
  const warnings = [];
  const ids = [];
  const unsandboxed = [];
  const declared = new Set(
    (Array.isArray(expectUnsandboxed) ? expectUnsandboxed : [expectUnsandboxed])
      .filter((value) => value != null && value !== "")
      .map(String),
  );
  const declaredSeen = new Set();
  const declaredNotNeeded = new Set();
  const needsDeclaration = [];

  for (const entry of list || []) {
    const label = String(entry);
    try {
      const { source, remote, url, file } = await resolveSource(
        entry,
        baseDir,
        fetchImpl,
      );
      const { infos, unsandboxed: needsUnsandboxed } = evaluateExtensionAny(
        source,
        remote ? url : file,
      );
      if (infos.length === 0) {
        warnings.push(
          `extension ${label} did not call Scratch.extensions.register()`,
        );
        continue;
      }
      for (const info of infos) {
        const count = registerInfo(catalog, info, label);
        if (!ids.includes(info.id)) ids.push(info.id);

        for (const name of [info.id, label]) {
          if (!declared.has(name)) continue;
          declaredSeen.add(name);
          if (!needsUnsandboxed) declaredNotNeeded.add(name);
        }

        if (needsUnsandboxed) {
          if (!unsandboxed.includes(info.id)) unsandboxed.push(info.id);
          needsDeclaration.push({ id: info.id, label });
        }

        if (remote) {
          extensionUrls[info.id] = url;
        } else if (localFileWarning) {
          warnings.push(
            `extension ${label} (id "${info.id}") is a local file; it will be referenced in ` +
              "project.extensions but not in extensionURLs. Bundle it with the PenguinMod packager " +
              "or host it before loading in the editor.",
          );
        }
        if (count === 0)
          warnings.push(
            `extension ${label} (id "${info.id}") exposes no usable blocks`,
          );
      }
    } catch (err) {
      warnings.push(
        `failed to load extension ${label}: ${err && err.message ? err.message : err}`,
      );
    }
  }

  // Extensions that only load unsandboxed error out unless the editor is allowed
  // to run them unsandboxed (or the project is packaged), so say so up front.
  for (const { id, label } of needsDeclaration) {
    if (declared.has(id) || declared.has(label)) continue;
    warnings.push(
      `extension ${label} (id "${id}") requires unsandboxed mode; allow it to run ` +
        `unsandboxed when opening the project in PenguinMod (or add "${id}" to ` +
        "project.unsandboxed in meowscript.yml once you trust it)",
    );
  }
  for (const name of declared) {
    if (declaredNotNeeded.has(name)) {
      warnings.push(
        `project.unsandboxed entry "${name}" loads in the sandbox; remove it from meowscript.yml`,
      );
    } else if (!declaredSeen.has(name)) {
      warnings.push(
        `project.unsandboxed entry "${name}" does not match any loaded extension`,
      );
    }
  }

  return { catalog, extensionUrls, warnings, ids, unsandboxed };
}
