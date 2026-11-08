// A small PNG and ZIP reader on node:zlib, so the art tools and tests need no image or archive dependency.
// decodePng handles 8-bit greyscale, RGB, palette, grey+alpha and RGBA without interlace, which covers PixelLab output.
import { crc32, deflateSync, inflateRawSync, inflateSync } from 'node:zlib';

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** @returns {{ width: number, height: number, rgba: Uint8Array }} */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let width = 0, height = 0, depth = 0, type = 0, interlace = 0, plte = null, trns = null;
  const idat = [];
  for (let o = 8; o < buf.length;) {
    const len = buf.readUInt32BE(o), name = buf.toString('latin1', o + 4, o + 8), body = buf.subarray(o + 8, o + 8 + len);
    if (name === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]; type = body[9]; interlace = body[12]; }
    else if (name === 'PLTE') plte = body;
    else if (name === 'tRNS') trns = body;
    else if (name === 'IDAT') idat.push(body);
    else if (name === 'IEND') break;
    o += 12 + len;
  }
  const ch = CHANNELS[type];
  if (depth !== 8 || !ch || interlace) throw new Error(`unsupported PNG (depth ${depth}, type ${type}, interlace ${interlace})`);
  const raw = inflateSync(Buffer.concat(idat)), stride = width * ch, px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[row + x - ch] : 0, b = y ? px[row - stride + x] : 0, c = x >= ch && y ? px[row - stride + x - ch] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
      px[row + x] = (raw[src + x] + pred) & 255;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * ch, d = i * 4;
    if (type === 6) rgba.set(px.subarray(s, s + 4), d);
    else if (type === 2) { rgba.set(px.subarray(s, s + 3), d); rgba[d + 3] = 255; }
    else if (type === 3) { const k = px[s]; rgba.set(plte.subarray(k * 3, k * 3 + 3), d); rgba[d + 3] = trns && k < trns.length ? trns[k] : 255; }
    else { rgba[d] = rgba[d + 1] = rgba[d + 2] = px[s]; rgba[d + 3] = type === 4 ? px[s + 1] : 255; }
  }
  return { width, height, rgba };
}

/** An 8-bit RGBA PNG, rows unfiltered. */
export function encodePng({ width, height, rgba }) {
  const chunk = (name, body) => {
    const b = Buffer.alloc(12 + body.length);
    b.writeUInt32BE(body.length, 0); b.write(name, 4, 'latin1'); body.copy(b, 8);
    b.writeUInt32BE(crc32(b.subarray(4, 8 + body.length)), 8 + body.length);
    return b;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Colours of the opaque pixels as '#RRGGBB', and how many pixels are neither opaque nor fully clear. */
export function pngColors(buf) {
  const { rgba } = decodePng(buf), colors = new Set();
  let partial = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue;
    if (rgba[i + 3] !== 255) partial++;
    colors.add('#' + [rgba[i], rgba[i + 1], rgba[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase());
  }
  return { colors, partial };
}

/** Every file in a ZIP archive, by its path. Stored and deflated entries only. */
export function unzip(buf) {
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('not a ZIP');
  const files = new Map();
  for (let o = buf.readUInt32LE(end + 16), n = buf.readUInt16LE(end + 10); n > 0; n--) {
    const method = buf.readUInt16LE(o + 10), size = buf.readUInt32LE(o + 20), nameLen = buf.readUInt16LE(o + 28);
    const extra = buf.readUInt16LE(o + 30), note = buf.readUInt16LE(o + 32), local = buf.readUInt32LE(o + 42);
    const name = buf.toString('utf8', o + 46, o + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28), data = buf.subarray(start, start + size);
    if (!name.endsWith('/')) files.set(name, method === 8 ? inflateRawSync(data) : method === 0 ? Buffer.from(data) : null);
    o += 46 + nameLen + extra + note;
  }
  return files;
}
