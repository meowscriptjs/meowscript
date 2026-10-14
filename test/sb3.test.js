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

function centralDirectoryOffsets(archive) {
  const eocd = archive.length - 22;
  const count = archive.readUInt16LE(eocd + 10);
  let offset = archive.readUInt32LE(eocd + 16);
  const offsets = [];
  for (let i = 0; i < count; i++) {
    offsets.push(offset);
    offset +=
      46 +
      archive.readUInt16LE(offset + 28) +
      archive.readUInt16LE(offset + 30) +
      archive.readUInt16LE(offset + 32);
  }
  return offsets;
}

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

test("unzipSync keeps the per-entry size limit", () => {
  const archive = zipSync([{ name: "large", data: Buffer.from("x") }]);
  const [entry] = centralDirectoryOffsets(archive);
  archive.writeUInt32LE(512 * 1024 * 1024 + 1, entry + 24);
  assert.throws(() => unzipSync(archive), /ZIP entry.*size limit/);
});

test("unzipSync limits cumulative size, including duplicate names", () => {
  for (const name of ["second", "first"]) {
    const archive = zipSync([
      { name: "first", data: Buffer.from("x") },
      { name, data: Buffer.from("y") },
    ]);
    const [first, second] = centralDirectoryOffsets(archive);
    // Edit declared sizes to exercise the limit without large allocations.
    archive.writeUInt32LE(256 * 1024 * 1024, first + 24);
    archive.writeUInt32LE(256 * 1024 * 1024, second + 24);
    assert.doesNotThrow(() => unzipSync(archive));
    archive.writeUInt32LE(256 * 1024 * 1024 + 1, second + 24);
    // The size check must reject before trying to inflate this invalid stream.
    archive.writeUInt16LE(8, second + 10);
    assert.throws(() => unzipSync(archive), /ZIP archive.*size limit/);
  }
});

test("unzipSync accepts an empty deflated entry at the archive size limit", () => {
  const archive = zipSync([
    { name: "first", data: Buffer.from("x") },
    { name: "empty", data: Buffer.from([3, 0]), compress: false },
  ]);
  const [first, empty] = centralDirectoryOffsets(archive);
  archive.writeUInt32LE(512 * 1024 * 1024, first + 24);
  // 03 00 is a raw DEFLATE stream producing zero bytes.
  archive.writeUInt16LE(8, empty + 10);
  archive.writeUInt32LE(0, empty + 24);
  const local = archive.readUInt32LE(empty + 42);
  archive.writeUInt16LE(8, local + 8);
  archive.writeUInt32LE(0, local + 22);
  assert.equal(unzipSync(archive).get("empty").length, 0);
});

test("unzipSync bounds actual output when an entry understates its size", () => {
  for (const compress of [false, true]) {
    const archive = zipSync([
      { name: "first", data: Buffer.from("x") },
      { name: "second", data: Buffer.from("y".repeat(64)), compress },
    ]);
    const [first, second] = centralDirectoryOffsets(archive);
    archive.writeUInt32LE(512 * 1024 * 1024 - 1, first + 24);
    archive.writeUInt32LE(1, second + 24);
    assert.throws(
      () => unzipSync(archive),
      compress ? { code: "ERR_BUFFER_TOO_LARGE" } : /ZIP archive.*size limit/,
    );
  }
});

test("unzipSync rejects unsupported compression methods", () => {
  const archive = zipSync([{ name: "asset", data: Buffer.from("x") }]);
  const [entry] = centralDirectoryOffsets(archive);
  archive.writeUInt16LE(9, 8);
  archive.writeUInt16LE(9, entry + 10);
  assert.throws(
    () => unzipSync(archive),
    /Unsupported ZIP compression method: 9/,
  );
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

test("imageSize resolves percentage SVG dimensions through viewBox", () => {
  for (const dimensions of [
    'width="100%" height="100%"',
    'width="10.5%" height="20"',
    "width='10' height='50%'",
    'width="100 %" height="100 %"',
  ]) {
    const svg = Buffer.from(`<svg ${dimensions} viewBox="0 0 320 180"/>`);
    assert.deepEqual(imageSize(svg, "svg"), { width: 320, height: 180 });
    assert.deepEqual(imageSize(Buffer.from(`<svg ${dimensions}/>`), "svg"), {
      width: 0,
      height: 0,
    });
  }
  assert.deepEqual(
    imageSize(Buffer.from('<svg width="10.5px" height="20px"/>'), "svg"),
    { width: 10.5, height: 20 },
  );
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

test("wavInfo reads fmt metadata after other chunks and their padding", () => {
  function chunk(id, data) {
    const header = Buffer.alloc(8);
    header.write(id, "ascii");
    header.writeUInt32LE(data.length, 4);
    return Buffer.concat([header, data, Buffer.alloc(data.length % 2)]);
  }

  for (const { rate, bits, channels } of [
    { rate: 22050, bits: 8, channels: 1 },
    { rate: 44100, bits: 16, channels: 2 },
  ]) {
    const bytesPerSample = (bits / 8) * channels;
    const fmt = Buffer.alloc(16);
    fmt.writeUInt16LE(1, 0); // PCM
    fmt.writeUInt16LE(channels, 2);
    fmt.writeUInt32LE(rate, 4);
    fmt.writeUInt32LE(rate * bytesPerSample, 8);
    fmt.writeUInt16LE(bytesPerSample, 12);
    fmt.writeUInt16LE(bits, 14);
    for (const leading of [
      chunk("JUNK", Buffer.alloc(3)),
      chunk("LIST", Buffer.alloc(6)),
    ]) {
      const body = Buffer.concat([
        leading,
        chunk("fmt ", fmt),
        chunk("JUNK", Buffer.alloc(1)),
        chunk("data", Buffer.alloc(5 * bytesPerSample)),
      ]);
      const header = Buffer.alloc(12);
      header.write("RIFF", 0, "ascii");
      header.writeUInt32LE(body.length + 4, 4);
      header.write("WAVE", 8, "ascii");
      assert.deepEqual(wavInfo(Buffer.concat([header, body])), {
        rate,
        sampleCount: 5,
      });
    }
  }
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
  const file = path.join(dir, "out.pmp");
  fs.writeFileSync(
    file,
    zipSync([{ name: "project.json", data: Buffer.from("{}") }]),
  );
  assert.ok(fs.statSync(file).size > 0);
});
