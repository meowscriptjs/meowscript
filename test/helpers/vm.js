import crypto from "node:crypto";
import { createRequire } from "node:module";

// PenguinMod's VM (github:PenguinMod/PenguinMod-Vm) is a browser module. It
// touches a handful of DOM globals at import time, so stub them before it is
// required. Loading a project does not exercise the stubbed methods.
globalThis.location ||= {
  search: "",
  href: "http://localhost/",
  origin: "http://localhost",
  protocol: "http:",
  host: "localhost",
  hostname: "localhost",
  pathname: "/",
  hash: "",
};
globalThis.DOMParser ||= class {
  parseFromString() {
    const empty = () => [];
    return {
      querySelectorAll: empty,
      getElementsByTagName: empty,
      querySelector: () => null,
    };
  }
};
globalThis.window ||= globalThis;
globalThis.self ||= globalThis;
globalThis.document ||= {
  createElement: () => ({
    style: {},
    getContext: () => null,
    appendChild() {},
    setAttribute() {},
    addEventListener() {},
  }),
  querySelector: () => null,
  addEventListener() {},
};

const require = createRequire(import.meta.url);
const VirtualMachine = require("scratch-vm");
const centralDispatch = require("scratch-vm/src/dispatch/central-dispatch");

// The VM needs a storage module to pull costumes/sounds out of the project zip
// and a renderer to turn those assets into skins; without them it logs
// "No storage module present" / "No rendering module present" warnings while
// loading. The tests only inspect the deserialized project structure and never
// draw anything, so minimal in-memory stand-ins are enough to load a project
// cleanly and headlessly.
const AssetType = {
  ImageVector: { name: "ImageVector", runtimeFormat: "svg" },
  ImageBitmap: { name: "ImageBitmap", runtimeFormat: "png" },
  Sound: { name: "Sound", runtimeFormat: "wav" },
};

const DataFormat = {
  SVG: "svg",
  PNG: "png",
  JPG: "jpg",
  BMP: "bmp",
  GIF: "gif",
  WAV: "wav",
  MP3: "mp3",
  OGG: "ogg",
  FLAC: "flac",
};

const md5 = (data) =>
  crypto.createHash("md5").update(Buffer.from(data)).digest("hex");

const storage = {
  AssetType,
  DataFormat,
  createAsset(assetType, dataFormat, data, assetId, generateId) {
    const bytes =
      data instanceof Uint8Array ? data : new Uint8Array(data ?? []);
    return {
      assetType,
      dataFormat,
      data: bytes,
      assetId: assetId ?? (generateId ? md5(bytes) : null),
      clean: true,
      encodeDataURI() {
        const base64 = Buffer.from(bytes).toString("base64");
        return `data:${dataFormat};base64,${base64}`;
      },
      decodeText() {
        return Buffer.from(bytes).toString("utf8");
      },
      encodeTextData(text) {
        this.data = new Uint8Array(Buffer.from(text, "utf8"));
        this.assetId = md5(this.data);
      },
    };
  },
};

const createRenderer = () => {
  let nextId = 0;
  const skins = {};
  const createSkin = (size = [0, 0]) => {
    const skinId = nextId++;
    // The pen extension reaches into `_allSkins` and reads `_size`/
    // `renderQuality` and calls `_setTexture` on the skins it created.
    skins[skinId] = {
      id: skinId,
      renderQuality: 1,
      _size: size,
      _setTexture() {},
    };
    return skinId;
  };
  return {
    // State the VM and the pen extension read directly.
    _allSkins: skins,
    _groupOrdering: [],
    useHighQualityRender: true,
    setLayerGroupOrdering() {},
    setPrivateSkinAccess() {},
    setUseHighQualityRender() {},
    setRenderOffscreen() {},
    setStageSize() {},
    draw() {},
    markDrawableAsNoninteractive() {},
    createDrawable() {
      return nextId++;
    },
    destroyDrawable() {},
    updateDrawableSkinId() {},
    updateDrawablePosition() {},
    updateDrawableDirectionScale() {},
    updateDrawableVisible() {},
    updateDrawableEffect() {},
    setDrawableOrder() {},
    getDrawableOrder() {
      return 0;
    },
    getFencedPositionOfDrawable(id, position) {
      return position;
    },
    getBounds() {
      return { left: 0, right: 0, top: 0, bottom: 0 };
    },
    getBoundsForBubble() {
      return { left: 0, right: 0, top: 0, bottom: 0 };
    },
    isTouchingDrawables() {
      return false;
    },
    drawableTouching() {
      return false;
    },
    getTouchingDrawablesPoint() {
      return [];
    },
    isTouchingColor() {
      return false;
    },
    createSVGSkin() {
      return createSkin();
    },
    createBitmapSkin() {
      return createSkin();
    },
    createPenSkin() {
      return createSkin();
    },
    getSkinSize(skinId) {
      return skins[skinId] ? skins[skinId]._size : [0, 0];
    },
    getSkinRotationCenter() {
      return [0, 0];
    },
    penClear() {},
    penLine() {},
    penPoint() {},
    penStamp() {},
    penTranslate() {},
  };
};

// A headless VM with in-memory storage and a no-op renderer attached.
export const createVm = () => {
  // The dispatch broker is a process-wide singleton. Every VM registers
  // 'runtime', 'extensions' and an 'extension_<n>_<id>' service for each
  // extension it loads; creating more than one VM therefore makes the VM log
  // "Central dispatch replacing existing service provider" as it overwrites the
  // previous VM's entries. The tests discard each VM, so drop the stale
  // providers first to keep load output clean.
  centralDispatch.services = {};
  const vm = new VirtualMachine();
  vm.attachStorage(storage);
  vm.attachRenderer(createRenderer());
  return vm;
};

// Build a fresh VM and load an sb3/pmp buffer into it.
export const loadProject = async (sb3) => {
  const vm = createVm();
  await vm.loadProject(sb3);
  return vm;
};
