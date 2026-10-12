import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  zipSync,
  unzipSync,
  md5hex,
  crc32,
  imageSize,
  wavInfo,
  detectFormat,
} from "../src/sb3.js";

test("zip round-trips multiple entries", () => {
  const files = [
    { name: "a.txt", data: Buffer.from("hello world hello world hello world") },
    { name: "b.bin", data: Buffer.from([0, 1, 2, 3, 4, 5]) },
  ];
  const zipped = zipSync(files);
  const out = unzipSync(zipped);
  assert.equal(
    out.get("a.txt").toString(),
    "hello world hello world hello world",
  );
  assert.deepEqual([...out.get("b.bin")], [0, 1, 2, 3, 4, 5]);
});

test("md5hex and crc32 match known values", () => {
  assert.equal(md5hex(Buffer.from("")), "d41d8cd98f00b204e9800998ecf8427e");
  assert.equal(crc32(Buffer.from("123456789")) >>> 0, 0xcbf43926);
});

test("imageSize reads png, gif and svg headers", () => {
  const png = Buffer.alloc(24);
  png.writeUInt32BE(0x89504e47, 0);
  png.writeUInt32BE(120, 16);
  png.writeUInt32BE(80, 20);
  assert.deepEqual(imageSize(png, "png"), { width: 120, height: 80 });

  const gif = Buffer.alloc(10);
  gif.writeUInt16LE(64, 6);
  gif.writeUInt16LE(32, 8);
  assert.deepEqual(imageSize(gif, "gif"), { width: 64, height: 32 });

  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="20"></svg>',
  );
  assert.deepEqual(imageSize(svg, "svg"), { width: 10, height: 20 });
});

test("wavInfo recovers rate and sample count", () => {
  const buf = Buffer.alloc(44);
  buf.write("RIFF", 0, "ascii");
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(2, 22); // channels
  buf.writeUInt32LE(44100, 24);
  buf.writeUInt32LE(44100 * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(8, 40);
  assert.deepEqual(wavInfo(buf), { rate: 44100, sampleCount: 2 });
});

test("detectFormat normalises common extensions", () => {
  assert.equal(detectFormat("assets/cat.PNG"), "png");
  assert.equal(detectFormat("x.jpeg"), "jpg");
  assert.equal(detectFormat("https://example.test/a.ogg?v=2"), "ogg");
});

test("unzipSync rejects non-zip input", () => {
  assert.throws(
    () => unzipSync(Buffer.from("not a zip at all")),
    /Not a ZIP archive/,
  );
});

test("zipSync output is a real file on disk", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meow-zip-"));
  const file = path.join(dir, "out.sb3");
  fs.writeFileSync(
    file,
    zipSync([{ name: "project.json", data: Buffer.from("{}") }]),
  );
  assert.ok(fs.statSync(file).size > 0);
});
