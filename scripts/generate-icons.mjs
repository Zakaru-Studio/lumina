// Generates placeholder application icons (PNG + ICO + ICNS) required by Tauri.
//
// These are simple solid-color rounded squares so the project compiles and
// bundles out of the box. Replace them with real artwork via:
//   npm run tauri icon path/to/your-icon.png
//
// Run with: node scripts/generate-icons.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "icons");
mkdirSync(outDir, { recursive: true });

// Brand color (indigo-500-ish) with an opaque rounded square on transparent bg.
const BG = [99, 102, 241, 255];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

// Builds an RGBA PNG buffer of a rounded square filling the canvas.
function makePng(size) {
  const radius = Math.round(size * 0.22);
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const inRounded = (x, y) => {
    const nx = Math.min(x, size - 1 - x);
    const ny = Math.min(y, size - 1 - y);
    if (nx >= radius || ny >= radius) return true;
    const dx = radius - nx;
    const dy = radius - ny;
    return dx * dx + dy * dy <= radius * radius;
  };
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter byte: none
    for (let x = 0; x < size; x++) {
      const o = rowStart + 1 + x * 4;
      if (inRounded(x, y)) {
        raw[o] = BG[0];
        raw[o + 1] = BG[1];
        raw[o + 2] = BG[2];
        raw[o + 3] = BG[3];
      } else {
        raw[o] = raw[o + 1] = raw[o + 2] = raw[o + 3] = 0;
      }
    }
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const sizes = {
  "32x32.png": 32,
  "128x128.png": 128,
  "128x128@2x.png": 256,
  "icon.png": 512,
};
const pngCache = {};
for (const [name, size] of Object.entries(sizes)) {
  const png = makePng(size);
  pngCache[size] = png;
  writeFileSync(join(outDir, name), png);
}

// ICO with PNG-compressed entries (256 + 32). Windows Vista+ supports embedded PNG.
function makeIco(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);
  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  entries.forEach((e, i) => {
    const d = dir.subarray(i * 16);
    d[0] = e.size >= 256 ? 0 : e.size;
    d[1] = e.size >= 256 ? 0 : e.size;
    d[2] = 0;
    d[3] = 0;
    d.writeUInt16LE(1, 4); // planes
    d.writeUInt16LE(32, 6); // bpp
    d.writeUInt32LE(e.png.length, 8);
    d.writeUInt32LE(offset, 12);
    offset += e.png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}
writeFileSync(
  join(outDir, "icon.ico"),
  makeIco([
    { size: 32, png: pngCache[32] || makePng(32) },
    { size: 256, png: pngCache[256] },
  ]),
);

// ICNS with a single 512px 'ic09' (PNG) entry — valid minimal Apple icon.
function makeIcns(png512) {
  const type = Buffer.from("ic09", "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(png512.length + 8, 0);
  const entry = Buffer.concat([type, len, png512]);
  const magic = Buffer.from("icns", "ascii");
  const total = Buffer.alloc(4);
  total.writeUInt32BE(entry.length + 8, 0);
  return Buffer.concat([magic, total, entry]);
}
writeFileSync(join(outDir, "icon.icns"), makeIcns(pngCache[512]));

console.log("Generated placeholder icons in", outDir);
