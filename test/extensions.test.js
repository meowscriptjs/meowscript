import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadExtensions, BlockType, ArgumentType } from "../src/extensions.js";

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

test("exposes the TurboWarp enum shims to extension code", () => {
  assert.equal(BlockType.COMMAND, "command");
  assert.equal(ArgumentType.STRING, "string");
});
