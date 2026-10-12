/**
 * Minimal, dependency-free .sb3 (ZIP) reader/writer plus asset helpers.
 *
 * The Scratch 3 project format is a ZIP archive containing `project.json`
 * alongside content-addressed asset files named `<md5>.<ext>`.
 */
import zlib from "node:zlib";
import crypto from "node:crypto";

// --------------------------------------------------------------------- crc32

let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  CRC_TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    CRC_TABLE[n] = c >>> 0;
  }
  return CRC_TABLE;
}

/** @param {Buffer|Uint8Array} buf */
export function crc32(buf) {
  const table = crcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** @param {Buffer|Uint8Array} buf */
export function md5hex(buf) {
  return crypto.createHash("md5").update(buf).digest("hex");
}

// ----------------------------------------------------------------------- zip

const DOS_TIME = 0; // 00:00:00
const DOS_DATE = ((2024 - 1980) << 9) | (1 << 5) | 1; // 2024-01-01

/**
 * Build a ZIP archive entirely in memory.
 * @param {Array<{name: string, data: Buffer|Uint8Array, compress?: boolean}>} files
 * @returns {Buffer}
 */
export function zipSync(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, "utf8");
    const raw = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
    const crc = crc32(raw);
    let method = 0;
    let stored = raw;
    if (file.compress !== false && raw.length > 0) {
      const deflated = zlib.deflateRawSync(raw, { level: 9 });
      if (deflated.length < raw.length) {
        method = 8;
        stored = deflated;
      }
    }

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 flag
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, stored);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(DOS_TIME, 12);
    cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(stored.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // extra
    cd.writeUInt16LE(0, 32); // comment
    cd.writeUInt16LE(0, 34); // disk
    cd.writeUInt16LE(0, 36); // internal attrs
    cd.writeUInt32LE(0, 38); // external attrs
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + stored.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuf, eocd]);
}

/**
 * Read a ZIP archive produced by {@link zipSync} (or any standard 32-bit zip).
 * @param {Buffer|Uint8Array} buf
 * @returns {Map<string, Buffer>}
 */
export function unzipSync(buf) {
  const data = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  // Find the End Of Central Directory record.
  let eocd = -1;
  for (let i = data.length - 22; i >= 0; i--) {
    if (data.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0)
    throw new Error("Not a ZIP archive (no end-of-central-directory record)");

  const count = data.readUInt16LE(eocd + 10);
  let ptr = data.readUInt32LE(eocd + 16);
  const out = new Map();

  for (let i = 0; i < count; i++) {
    if (data.readUInt32LE(ptr) !== 0x02014b50)
      throw new Error("Corrupt ZIP central directory");
    const method = data.readUInt16LE(ptr + 10);
    const compSize = data.readUInt32LE(ptr + 20);
    const nameLen = data.readUInt16LE(ptr + 28);
    const extraLen = data.readUInt16LE(ptr + 30);
    const commentLen = data.readUInt16LE(ptr + 32);
    const localOffset = data.readUInt32LE(ptr + 42);
    const name = data.slice(ptr + 46, ptr + 46 + nameLen).toString("utf8");

    const localNameLen = data.readUInt16LE(localOffset + 26);
    const localExtraLen = data.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const raw = data.slice(dataStart, dataStart + compSize);
    out.set(name, method === 8 ? zlib.inflateRawSync(raw) : raw);

    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// -------------------------------------------------------------------- assets

const EXT_FORMAT = {
  svg: "svg",
  png: "png",
  jpg: "jpg",
  jpeg: "jpg",
  gif: "gif",
  bmp: "bmp",
  wav: "wav",
  mp3: "mp3",
  ogg: "ogg",
};

/**
 * @param {string} filePath
 * @returns {string} the Scratch dataFormat for a path/URL.
 */
export function extensionOf(filePath) {
  const clean = String(filePath).split(/[?#]/)[0];
  const match = /\.([a-z0-9]+)$/i.exec(clean);
  return match ? match[1].toLowerCase() : "";
}

/**
 * Read the pixel dimensions of an image buffer (SVG, PNG, JPG or GIF).
 * Falls back to 0x0 when unknown.
 * @param {Buffer} buffer
 * @param {string} format
 * @returns {{width: number, height: number}}
 */
export function imageSize(buffer, format) {
  try {
    if (
      format === "png" &&
      buffer.length >= 24 &&
      buffer.readUInt32BE(0) === 0x89504e47
    ) {
      return {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20),
      };
    }
    if (format === "gif" && buffer.length >= 10) {
      return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
    }
    if (format === "jpg") {
      let i = 2;
      while (i < buffer.length) {
        if (buffer[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = buffer[i + 1];
        if (
          marker >= 0xc0 &&
          marker <= 0xcf &&
          marker !== 0xc4 &&
          marker !== 0xc8 &&
          marker !== 0xcc
        ) {
          return {
            height: buffer.readUInt16BE(i + 5),
            width: buffer.readUInt16BE(i + 7),
          };
        }
        i += 2 + buffer.readUInt16BE(i + 2);
      }
    }
    if (format === "svg") {
      const text = buffer.toString("utf8");
      const w = /<svg[^>]*\bwidth\s*=\s*["']([\d.]+)/i.exec(text);
      const h = /<svg[^>]*\bheight\s*=\s*["']([\d.]+)/i.exec(text);
      if (w && h) return { width: Number(w[1]), height: Number(h[1]) };
      const vb = /viewBox\s*=\s*["']([^"']+)["']/i.exec(text);
      if (vb) {
        const nums = vb[1]
          .trim()
          .split(/[\s,]+/)
          .map(Number);
        if (nums.length === 4 && nums.every((n) => Number.isFinite(n))) {
          return { width: nums[2], height: nums[3] };
        }
      }
    }
  } catch {
    /* fall through to zero dimensions */
  }
  return { width: 0, height: 0 };
}

/**
 * Parse a WAV file header to recover rate + sample count.
 * @param {Buffer} buffer
 * @returns {{rate: number, sampleCount: number}}
 */
export function wavInfo(buffer) {
  try {
    if (
      buffer.length >= 44 &&
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WAVE"
    ) {
      const rate = buffer.readUInt32LE(24);
      const bits = buffer.readUInt16LE(34);
      const channels = buffer.readUInt16LE(22);
      // locate the data chunk
      let i = 12;
      while (i + 8 <= buffer.length) {
        const id = buffer.toString("ascii", i, i + 4);
        const size = buffer.readUInt32LE(i + 4);
        if (id === "data") {
          const bytesPerSample = Math.max(1, (bits / 8) * channels);
          return { rate, sampleCount: Math.floor(size / bytesPerSample) };
        }
        i += 8 + size + (size % 2);
      }
      return { rate, sampleCount: 0 };
    }
  } catch {
    /* ignore */
  }
  return { rate: 48000, sampleCount: 0 };
}

/** @returns {string} Normalise a costume dataFormat used in project.json. */
export function detectFormat(filePath) {
  return EXT_FORMAT[extensionOf(filePath)] || extensionOf(filePath) || "png";
}
