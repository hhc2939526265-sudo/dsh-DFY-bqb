// 表情库：JSON 索引 + 文件入库，状态机（pending/approved/blocked）、计数、去重。
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileHash, nowIso, todayKey } from './util.mjs';

const INDEX_FILE = 'index.json';
const SUBDIRS = { images: 'images', derived: 'derived' };

export class BqbStore {
  constructor(rootDir) {
    this.root = rootDir;
    this.indexPath = join(rootDir, INDEX_FILE);
    this._ensureDirs();
    this.data = this._load();
  }

  _ensureDirs() {
    if (!existsSync(this.root)) mkdirSync(this.root, { recursive: true });
    for (const sub of Object.values(SUBDIRS)) {
      const p = join(this.root, sub);
      if (!existsSync(p)) mkdirSync(p, { recursive: true });
    }
  }

  _load() {
    if (!existsSync(this.indexPath)) {
      return { stickers: [], daily: {}, seen: [], version: 1 };
    }
    try {
      const parsed = JSON.parse(readFileSync(this.indexPath, 'utf8'));
      return {
        stickers: parsed.stickers || [],
        daily: parsed.daily || {},
        seen: parsed.seen || [],
        version: parsed.version || 1,
      };
    } catch {
      return { stickers: [], daily: {}, seen: [], version: 1 };
    }
  }

  save() {
    writeFileSync(this.indexPath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  all() {
    return this.data.stickers;
  }

  get(id) {
    return this.data.stickers.find((s) => s.id === id) || null;
  }

  listByStatus(status) {
    return this.data.stickers.filter((s) => s.status === status);
  }

  listApproved() {
    return this.listByStatus('approved');
  }

  findByHash(hash) {
    return this.data.stickers.find((s) => s.hash === hash) || null;
  }

  // 入库：拷贝文件到 images，重复内容按 hash 去重；autoApprove 决定初始状态
  ingestImage({
    imagePath, source = 'builtin', emotion = 'daily', tags = [],
    keywords = [], caption = '', autoApprove = false, name = '',
  }) {
    const hash = fileHash(imagePath);
    const dup = this.findByHash(hash);
    if (dup) {
      return { sticker: dup, duplicated: true };
    }
    const id = `stk_${hash.slice(0, 12)}`;
    const ext = (imagePath.match(/\.(png|jpg|jpeg|gif|webp)$/i) || ['.png'])[0].toLowerCase();
    const dest = join(this.root, SUBDIRS.images, `${id}${ext}`);
    copyFileSync(imagePath, dest);
    const sticker = {
      id,
      name: name || caption || id,
      path: dest,
      hash,
      emotion,
      tags,
      keywords,
      caption,
      source,
      status: autoApprove ? 'approved' : 'pending',
      useCount: 0,
      lastUsed: null,
      createdAt: nowIso(),
    };
    this.data.stickers.push(sticker);
    this.save();
    return { sticker, duplicated: false };
  }

  updateStatus(id, status) {
    const sticker = this.get(id);
    if (!sticker) return { ok: false, reason: 'not found' };
    if (!['pending', 'approved', 'blocked'].includes(status)) {
      return { ok: false, reason: 'invalid status' };
    }
    sticker.status = status;
    this.save();
    return { ok: true, sticker };
  }

  recordUse(id) {
    const sticker = this.get(id);
    if (!sticker) return;
    sticker.useCount += 1;
    sticker.lastUsed = nowIso();
    this.save();
  }

  // ---- 每日计数（按对象）----
  _todayBucket() {
    const key = todayKey();
    if (!this.data.daily[key]) this.data.daily[key] = { total: 0, peers: {} };
    return this.data.daily[key];
  }

  incrementDaily(peer) {
    const b = this._todayBucket();
    b.total += 1;
    if (peer) b.peers[peer] = (b.peers[peer] || 0) + 1;
    this.save();
  }

  dailyStickerCount() {
    const key = todayKey();
    return this.data.daily[key]?.total || 0;
  }

  peerDailyCount(peer) {
    const key = todayKey();
    return this.data.daily[key]?.peers?.[peer] || 0;
  }

  // ---- 去重：已处理过的消息 hash ----
  markSeen(messageHash) {
    if (!this.data.seen.includes(messageHash)) {
      this.data.seen.push(messageHash);
      // 控制 seen 体积，保留最近 1000 条
      if (this.data.seen.length > 1000) {
        this.data.seen = this.data.seen.slice(-1000);
      }
      this.save();
    }
  }

  hasSeen(messageHash) {
    return this.data.seen.includes(messageHash);
  }
}
