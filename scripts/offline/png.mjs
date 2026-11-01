// A small PNG decoder for the pack builder: 8-bit greyscale, RGB, palette, grey+alpha and RGBA,
// not interlaced. That covers the Terrarium elevation tiles; anything else is refused loudly.
import { inflateSync } from 'node:zlib';

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Returns { width, height, channels, data } with palette images expanded to RGB. */
export function decodePng(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  for (let i = 0; i < 8; i++) if (buf[i] !== SIG[i]) throw new Error('not a PNG');
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = 0;
  let interlace = 0;
  let palette = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const name = buf.toString('latin1', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (name === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      type = body[9];
      interlace = body[12];
    } else if (name === 'PLTE') palette = body;
    else if (name === 'IDAT') idat.push(body);
    else if (name === 'IEND') break;
  }
  const ch = CHANNELS[type];
  if (!width || !height || depth !== 8 || interlace !== 0 || !ch) throw new Error(`unsupported PNG (depth ${depth}, type ${type}, interlace ${interlace})`);
  if (type === 3 && !palette) throw new Error('palette PNG without a palette');
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  if (raw.length < height * (stride + 1)) throw new Error('PNG data is cut short');
  const px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    const up = row - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= ch ? px[row + i - ch] : 0;
      const b = y > 0 ? px[up + i] : 0;
      const c = y > 0 && i >= ch ? px[up + i - ch] : 0;
      let v;
      if (filter === 0) v = x;
      else if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new Error(`bad PNG filter ${filter}`);
      px[row + i] = v & 255;
    }
  }
  if (type !== 3) return { width, height, channels: ch, data: px };
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) palette.copy(rgb, i * 3, px[i] * 3, px[i] * 3 + 3);
  return { width, height, channels: 3, data: rgb };
}
