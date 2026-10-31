// 测试辅助：临时 store + 标准 1x1 PNG 生成 + 构造分情绪的 approved 表情
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import zlib from 'node:zlib';
import { BqbStore } from '../lib/bqb-store.mjs';

// PNG 标准签名
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

// 构造标准 1x1 RGB 纯色 PNG：不同颜色 → 不同字节 → 不同 hash（避免被去重逻辑合并）
function buildPng(r, g, b) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); // width
  ihdr.writeUInt32BE(1, 4); // height
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type = truecolor RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  // 1 条扫描行：filter(0) + RGB
  const raw = Buffer.from([0, r, g, b]);
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    PNG_SIG,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

export function makeTmpStore() {
  const dir = mkdtempSync(join(tmpdir(), 'dfy-bqb-'));
  const store = new BqbStore(dir);
  return { dir, store };
}

// 按名称哈希稳定取色：同名图片内容一致，不同名内容不同
export function writePng(dir, name) {
  const p = join(dir, name);
  const color = zlib.crc32(name) >>> 0;
  writeFileSync(p, buildPng(color & 255, (color >> 8) & 255, (color >> 16) & 255));
  return p;
}

// 构造一组分情绪的 approved 表情
export function seedApproved(store, dir) {
  const specs = [
    { emotion: 'happy', tags: ['grin', 'celebrate'], keywords: ['开心', '哈哈'], caption: '开心' },
    { emotion: 'happy', tags: ['hug', 'soft'], keywords: ['抱抱'], caption: '抱抱' },
    { emotion: 'sad', tags: ['cry', 'tissue'], keywords: ['难过', '哭'], caption: '难过' },
    { emotion: 'shy', tags: ['hug', 'pat', 'soft'], keywords: ['安慰', '抱抱'], caption: '安慰' },
    { emotion: 'daily', tags: ['listen'], keywords: ['日常'], caption: '日常' },
    { emotion: 'confused', tags: ['think', 'question'], keywords: ['疑惑'], caption: '疑惑' },
  ];
  const out = [];
  specs.forEach((s, i) => {
    const img = writePng(dir, `seed_${i}.png`);
    const r = store.ingestImage({
      imagePath: img, source: 'builtin', emotion: s.emotion,
      tags: s.tags, keywords: s.keywords, caption: s.caption, autoApprove: true,
    });
    out.push(r.sticker);
  });
  return out;
}
