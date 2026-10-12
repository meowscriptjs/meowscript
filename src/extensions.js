/**
 * TurboWarp extension bindings.
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
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

/** `Scratch.BlockType` (values used by scratch-vm / TurboWarp). */
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
  COSTUME: "costume",
  SOUND: "sound",
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

function makeSandbox(registered) {
  const Scratch = {
    extensions: {
      register(extension) {
        registered.push(extension);
      },
      unsandboxed: false,
    },
    BlockType,
    ArgumentType,
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
    canDownload: () => Promise.resolve(false),
    download: () =>
      Promise.reject(
        new Error("Scratch.download is not available while compiling"),
      ),
    vm: {},
    renderer: {},
    gui: null,
    // Some extensions probe these at module scope.
    runtime: {},
    stage: {},
  };

  const sandbox = {
    Scratch,
    ScratchExtensions: {
      register() {
        /* legacy ScratchX extensions unsupported */
      },
    },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
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
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  return sandbox;
}

/** Evaluate extension source and return the `getInfo()` results. */
function evaluateExtension(source, filename) {
  const registered = [];
  const context = vm.createContext(makeSandbox(registered));
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
 * Load a list of extension references.
 *
 * @param {Array<string>} list Paths or `http(s)://` URLs.
 * @param {{baseDir?: string, fetchImpl?: typeof fetch}} [options]
 * @returns {Promise<{catalog: Record<string, object>, extensionUrls: Record<string, string>, warnings: string[], ids: string[]}>}
 */
export async function loadExtensions(
  list,
  { baseDir = process.cwd(), fetchImpl } = {},
) {
  const catalog = {};
  const extensionUrls = {};
  const warnings = [];
  const ids = [];

  for (const entry of list || []) {
    const label = String(entry);
    try {
      const { source, remote, url, file } = await resolveSource(
        entry,
        baseDir,
        fetchImpl,
      );
      const infos = evaluateExtension(source, remote ? url : file);
      if (infos.length === 0) {
        warnings.push(
          `extension ${label} did not call Scratch.extensions.register()`,
        );
        continue;
      }
      for (const info of infos) {
        const count = registerInfo(catalog, info, label);
        if (!ids.includes(info.id)) ids.push(info.id);
        if (remote) {
          extensionUrls[info.id] = url;
        } else {
          warnings.push(
            `extension ${label} (id "${info.id}") is a local file; it will be referenced in ` +
              "project.extensions but not in extensionURLs. Bundle it with the TurboWarp packager " +
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

  return { catalog, extensionUrls, warnings, ids };
}
