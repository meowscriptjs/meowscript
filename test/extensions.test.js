import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  loadExtensions,
  BlockType,
  ArgumentType,
  BlockShape,
  NotchShape,
} from "../src/extensions.js";

function tempExtension(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meow-ext-"));
  fs.writeFileSync(path.join(dir, "ext.js"), source);
  return dir;
}

const SIGNALS = `
(function (Scratch) {
  'use strict';
  class Signals {
    getInfo () {
      return {
        id: 'signals',
        name: 'Signals',
        blocks: [
          {opcode: 'send', blockType: Scratch.BlockType.COMMAND, text: 'send [MSG]',
           arguments: {MSG: {type: Scratch.ArgumentType.STRING, defaultValue: 'hi'}}},
          {opcode: 'level', blockType: Scratch.BlockType.REPORTER, text: 'level'},
          {opcode: 'isOn', blockType: Scratch.BlockType.BOOLEAN, text: 'is on?'},
          {opcode: 'loop', blockType: Scratch.BlockType.LOOP, text: 'loop', branchCount: 2},
          {opcode: 'whenBang', blockType: Scratch.BlockType.HAT, text: 'when bang [WHO]',
           arguments: {WHO: {type: Scratch.ArgumentType.STRING, defaultValue: 'all'}}}
        ]
      };
    }
    send () {}
    level () { return 1; }
    isOn () { return true; }
  }
  Scratch.extensions.register(new Signals());
})(Scratch);
`;

test("synthesizes catalog entries with the right kinds and opcodes", async () => {
  const dir = tempExtension(SIGNALS);
  const { catalog, warnings } = await loadExtensions(["./ext.js"], {
    baseDir: dir,
  });
  assert.ok(warnings.some((w) => /local file/.test(w)));

  assert.equal(catalog["signals.send"].opcode, "signals_send");
  assert.equal(catalog["signals.send"].kind, "command");
  assert.deepEqual(catalog["signals.send"].inputs.MSG, { type: "string" });
  assert.equal(catalog["signals.send"].extension, "signals");
  assert.equal(catalog["signals.level"].kind, "reporter");
  assert.equal(catalog["signals.isOn"].kind, "boolean");
  assert.equal(catalog["signals.whenBang"].kind, "hat");
  assert.deepEqual(catalog["signals.whenBang"].args, [
    { input: "WHO", type: "string" },
  ]);
});

test("gives loops and conditionals substacks based on branchCount", async () => {
  const dir = tempExtension(SIGNALS);
  const { catalog } = await loadExtensions(["./ext.js"], { baseDir: dir });
  assert.deepEqual(catalog["signals.loop"].inputs.SUBSTACK, {
    type: "substack",
  });
  assert.deepEqual(catalog["signals.loop"].inputs.SUBSTACK2, {
    type: "substack",
  });
});

test("fetches remote extensions and records their URL", async () => {
  const fetched = [];
  const fetchImpl = async (url) => {
    fetched.push(url);
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => SIGNALS,
    };
  };
  const { catalog, extensionUrls } = await loadExtensions(
    ["https://example.test/signals.js"],
    { fetchImpl },
  );
  assert.deepEqual(fetched, ["https://example.test/signals.js"]);
  assert.equal(extensionUrls.signals, "https://example.test/signals.js");
  assert.ok(catalog["signals.send"]);
});

test("warns instead of throwing for broken extensions", async () => {
  const dir = tempExtension("this is not valid javascript {{{");
  const { catalog, warnings } = await loadExtensions(["./ext.js"], {
    baseDir: dir,
  });
  assert.deepEqual(catalog, {});
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /failed to load extension/);
});

test("warns when an extension never registers", async () => {
  const dir = tempExtension("const unused = 1;");
  const { warnings } = await loadExtensions(["./ext.js"], { baseDir: dir });
  assert.ok(
    warnings.some((w) => /did not call Scratch.extensions.register/.test(w)),
  );
});

test("runs extensions in a sandbox without process or require", async () => {
  const dir = tempExtension(`
        (function (Scratch) {
            if (typeof process !== 'undefined') throw new Error('process leaked');
            if (typeof require !== 'undefined') throw new Error('require leaked');
            if (typeof module !== 'undefined') throw new Error('module leaked');
            Scratch.extensions.register({getInfo () { return {id: 'safe', blocks: []}; }});
        })(Scratch);
    `);
  const { warnings, ids } = await loadExtensions(["./ext.js"], {
    baseDir: dir,
  });
  assert.deepEqual(
    warnings.filter((w) => /failed/.test(w)),
    [],
  );
  assert.deepEqual(ids, ["safe"]);
});

test("shim constructors cannot reach Node APIs or mutate host objects", async (t) => {
  const dir = tempExtension(`
    const constructors = [
      Scratch.extensions.register.constructor,
      Scratch.Cast.toString.constructor,
      Scratch.Color.decimalToHex.constructor,
      Scratch.Clone.simple.constructor,
      console.log.constructor, setTimeout.constructor,
      Math.max.constructor, URL.constructor,
      Uint8Array.constructor, Object.constructor
    ];
    for (const Constructor of constructors) {
      const hostProcess = Constructor('return typeof process === "undefined" ? null : process')();
      if (typeof hostProcess?.pid === 'number') {
        throw new Error('Node APIs leaked');
      }
    }
    Object.prototype.meowExtensionPollution = true;
    Scratch.extensions.register({getInfo() { return {id: 'isolated', blocks: []}; }});
  `);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { ids, warnings } = await loadExtensions(["./ext.js"], {
    baseDir: dir,
  });
  assert.deepEqual(ids, ["isolated"], warnings.join("\n"));
  assert.equal(Object.prototype.meowExtensionPollution, undefined);
});

test("bounds source execution and getInfo execution in the CLI", (t) => {
  const bin = fileURLToPath(new URL("../bin/meowscript.js", import.meta.url));
  for (const source of [
    "while (true) {}",
    "Scratch.extensions.register({getInfo() { while (true) {} }});",
    "Scratch.extensions.register({getInfo() { return {toJSON() { while (true) {} }}; }});",
  ]) {
    const dir = tempExtension(source);
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(
      path.join(dir, "meowscript.yml"),
      'project:\n  extensions: ["./ext.js"]\n',
    );
    const result = spawnSync(process.execPath, [bin, "catalog", dir], {
      encoding: "utf8",
      timeout: 12000,
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /extension execution timed out/);
  }
});

const UNSANDBOXED = `
(function (Scratch) {
  'use strict';
  if (!Scratch.extensions.unsandboxed) {
    throw new Error('"Demo" must run unsandboxed');
  }
  Scratch.extensions.register({
    getInfo () {
      return {
        id: 'demo',
        name: 'Demo',
        blocks: [{opcode: 'go', blockType: Scratch.BlockType.COMMAND, text: 'go'}]
      };
    },
    go () {}
  });
})(Scratch);
`;

test("loads extensions that only work unsandboxed and flags them", async () => {
  const dir = tempExtension(UNSANDBOXED);
  const { catalog, ids, unsandboxed, warnings } = await loadExtensions(
    ["./ext.js"],
    { baseDir: dir },
  );
  assert.deepEqual(ids, ["demo"]);
  assert.deepEqual(unsandboxed, ["demo"]);
  assert.equal(catalog["demo.go"].opcode, "demo_go");
  assert.ok(
    warnings.some((w) => /requires unsandboxed mode/.test(w)),
    warnings.join("\n"),
  );
});

test("silences the unsandboxed warning for declared extensions", async () => {
  const dir = tempExtension(UNSANDBOXED);
  const { unsandboxed, warnings } = await loadExtensions(["./ext.js"], {
    baseDir: dir,
    expectUnsandboxed: ["demo"],
  });
  assert.deepEqual(unsandboxed, ["demo"]);
  assert.deepEqual(
    warnings.filter((w) => /unsandboxed/.test(w)),
    [],
  );
});

test("flags a declared extension that actually loads sandboxed", async () => {
  const dir = tempExtension(SIGNALS);
  const { warnings } = await loadExtensions(["./ext.js"], {
    baseDir: dir,
    expectUnsandboxed: ["signals"],
  });
  assert.ok(
    warnings.some((w) => /loads in the sandbox/.test(w)),
    warnings.join("\n"),
  );
});

test("flags a declared entry that matches no loaded extension", async () => {
  const dir = tempExtension(SIGNALS);
  const { warnings } = await loadExtensions(["./ext.js"], {
    baseDir: dir,
    expectUnsandboxed: ["nope"],
  });
  assert.ok(
    warnings.some((w) => /does not match any loaded extension/.test(w)),
    warnings.join("\n"),
  );
});

test("treats an alert-and-return guard as requiring unsandboxed", async () => {
  const dir = tempExtension(`
        (function (Scratch) {
            if (!Scratch.extensions.unsandboxed) {
                alert('Nope must run unsandboxed!');
                return;
            }
            Scratch.extensions.register({getInfo () { return {id: 'nope', blocks: [
                {opcode: 'go', blockType: Scratch.BlockType.COMMAND, text: 'go'}
            ]}; }});
        })(Scratch);
    `);
  const { catalog, ids, unsandboxed } = await loadExtensions(["./ext.js"], {
    baseDir: dir,
  });
  assert.deepEqual(ids, ["nope"]);
  assert.deepEqual(unsandboxed, ["nope"]);
  assert.equal(catalog["nope.go"].opcode, "nope_go");
});

test("tolerates module-scope VM and browser access", async () => {
  const dir = tempExtension(`
        (function (Scratch) {
            const runtime = Scratch.vm.runtime;
            runtime.on('PROJECT_START', () => {});
            runtime.registerSerializer('x', v => v, v => v);
            const canvas = document.createElement('canvas');
            canvas.width = navigator.language.length;
            new Audio('data:audio/mp3;base64,');
            Scratch.extensions.register({getInfo () { return {id: 'vmish', blocks: [
                {opcode: 'go', blockType: Scratch.BlockType.COMMAND, text: 'go'}
            ]}; }});
        })(Scratch);
    `);
  const { catalog, warnings, ids } = await loadExtensions(["./ext.js"], {
    baseDir: dir,
  });
  assert.deepEqual(ids, ["vmish"]);
  assert.equal(catalog["vmish.go"].opcode, "vmish_go");
  assert.deepEqual(
    warnings.filter((w) => /failed/.test(w)),
    [],
  );
});

test("exposes PenguinMod detection to extension code", async () => {
  const dir = tempExtension(`
        (function (Scratch) {
            if (Scratch.extensions.isPenguinMod !== true) throw new Error('not penguinmod');
            Scratch.extensions.register({getInfo () { return {id: 'pm', blocks: []}; }});
        })(Scratch);
    `);
  const { ids, warnings } = await loadExtensions(["./ext.js"], {
    baseDir: dir,
  });
  assert.deepEqual(ids, ["pm"]);
  assert.deepEqual(
    warnings.filter((w) => /failed/.test(w)),
    [],
  );
});

test("warns on HTTP errors for remote extensions", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 404,
    statusText: "Not Found",
    text: async () => "",
  });
  const { warnings } = await loadExtensions(
    ["https://example.test/missing.js"],
    { fetchImpl },
  );
  assert.match(warnings[0], /HTTP 404/);
});

test("exposes the PenguinMod enum shims to extension code", () => {
  assert.equal(BlockType.COMMAND, "command");
  assert.equal(ArgumentType.STRING, "string");
  assert.equal(BlockShape.SQUARE, 3);
  assert.equal(NotchShape.ARROW, "arrow");
});
