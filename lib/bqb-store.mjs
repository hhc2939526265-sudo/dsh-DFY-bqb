// 大肥鱼表情库存储：JSON 索引（零原生依赖），结构对齐底座 stickers.json 并扩展四种来源。
// 状态机：pending（待审核）/ approved（可发送）/ blocked（拉黑）。只有 approved 能发出。
import { existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  readJson, writeJson, ensureDir, fileHash, sha256Text, nowIso, todayStr, isImageFile,
} from './util.mjs';
import { EMOTIONS } from './emotion.mjs';

export const SOURCES = ['web-search', 'derive', 'doubao', 'owner', 'comment', 'dm', 'builtin'];
export const STATUSES = ['pending', 'approved', 'blocked'];

// 名称黑名单：命中直接 blocked（视觉审核需外部能力/人工，这里先做名称层硬过滤）
const NAME_BLACKLIST = ['色情', '裸', '血腥', '暴力', '恐怖', '政治', '赌博', '毒品', '自杀'];

function defaultStore() {
  return { version: 1, stickers: [], updatedAt: nowIso() };
}

export class BqbStore {
  constructor(dataDir) {
    this.dataDir = ensureDir(dataDir);
    this.imagesDir = ensureDir(join(dataDir, 'images'));
    this.storeFile = join(dataDir, 'store.json');
    this.counterFile = join(dataDir, 'counters.json');
    this.stateFile = join(dataDir, 'state.json');
    this.store = readJson(this.storeFile, defaultStore());
    if (!this.store.stickers) this.store = defaultStore();
  }

  save() {
    this.store.updatedAt = nowIso();
    writeJson(this.storeFile, this.store);
  }

  all() {
    return this.store.stickers;
  }

  get(id) {
    return this.store.stickers.find((s) => s.id === id) || null;
  }

  byHash(hash) {
    return this.store.stickers.find((s) => s.hash === hash) || null;
  }

  listApproved() {
    return this.store.stickers.filter((s) => s.status === 'approved');
  }

  listByStatus(status) {
    return this.store.stickers.filter((s) => s.status === status);
  }

  // 名称黑名单检查
  static nameBlocked(text) {
    const t = String(text || '').toLowerCase();
    return NAME_BLACKLIST.some((w) => t.includes(w));
  }

  /**
   * 入库一张本地图片（复制进 images 目录，去重，打状态）
   * @returns {{sticker?:object, duplicated?:boolean, reason?:string}}
   */
  ingestImage({
    imagePath, source, emotion = 'daily', tags = [], keywords = [], caption = '',
    autoApprove = false, sourceRef = '',
  }) {
    if (!existsSync(imagePath) || !isImageFile(imagePath)) {
      return { reason: '图片不存在或不是受支持的图片格式' };
    }
    if (!SOURCES.includes(source)) return { reason: `非法来源：${source}` };
    if (emotion && !EMOTIONS.includes(emotion)) return { reason: `非法情绪桶：${emotion}` };

    const hash = fileHash(imagePath);
    const dup = this.byHash(hash);
    if (dup) return { duplicated: true, sticker: dup };

    const id = `stk_${sha256Text(hash + nowIso()).slice(0, 12)}`;
    const ext = imagePath.split('.').pop().toLowerCase();
    const dest = join(this.imagesDir, `${id}.${ext}`);
    copyFileSync(imagePath, dest);

    const nameText = `${caption} ${keywords.join(' ')} ${sourceRef}`;
    const blocked = BqbStore.nameBlocked(nameText);
    const status = blocked ? 'blocked' : autoApprove ? 'approved' : 'pending';

    const sticker = {
      id,
      path: dest,
      hash,
      emotion,
      tags: [...new Set(tags)].map(String),
      keywords: [...new Set(keywords)].map(String),
      caption: String(caption),
      source,
      sourceRef: String(sourceRef),
      status,
      useCount: 0,
      lastUsedAt: null,
      createdAt: nowIso(),
      approvedAt: status === 'approved' ? nowIso() : null,
    };
    this.store.stickers.push(sticker);
    this.save();
    return { sticker };
  }

  // 直接登记一个已有路径（不复制，用于底座库或外部目录引用）
  registerExternal({
    path, source, emotion = 'daily', tags = [], keywords = [], caption = '', autoApprove = true,
  }) {
    if (!existsSync(path)) return { reason: '外部图片不存在' };
    const hash = fileHash(path);
    const dup = this.byHash(hash);
    if (dup) return { duplicated: true, sticker: dup };
    const id = `stk_${sha256Text(hash + nowIso()).slice(0, 12)}`;
    const sticker = {
      id, path, hash, emotion,
      tags: [...new Set(tags)].map(String),
      keywords: [...new Set(keywords)].map(String),
      caption: String(caption), source, sourceRef: 'external',
      status: autoApprove ? 'approved' : 'pending',
      useCount: 0, lastUsedAt: null, createdAt: nowIso(),
      approvedAt: autoApprove ? nowIso() : null,
    };
    this.store.stickers.push(sticker);
    this.save();
    return { sticker };
  }

  updateStatus(id, status) {
    if (!STATUSES.includes(status)) return { reason: `非法状态：${status}` };
    const s = this.get(id);
    if (!s) return { reason: '表情不存在' };
    s.status = status;
    s.approvedAt = status === 'approved' ? nowIso() : s.approvedAt;
    this.save();
    return { sticker: s };
  }

  recordUse(id) {
    const s = this.get(id);
    if (!s) return null;
    s.useCount += 1;
    s.lastUsedAt = nowIso();
    this.save();
    return s;
  }

  // ---- 每日计数（风控用）----
  loadCounters() {
    return readJson(this.counterFile, {});
  }

  saveCounters(c) {
    writeJson(this.counterFile, c);
  }

  // 当天贴纸发送数（可按 peer 过滤）
  dailyStickerCount(peer = null) {
    const c = this.loadCounters();
    const day = todayStr();
    const rec = c[day] || { total: 0, peers: {} };
    if (peer) return rec.peers[peer] || 0;
    return rec.total || 0;
  }

  incrementDaily(peer) {
    const c = this.loadCounters();
    const day = todayStr();
    if (!c[day]) c[day] = { total: 0, peers: {} };
    c[day].total += 1;
    if (peer) c[day].peers[peer] = (c[day].peers[peer] || 0) + 1;
    this.saveCounters(c);
    return c[day];
  }

  // ---- 消息去重状态 ----
  loadState() {
    return readJson(this.stateFile, { seen: {} });
  }

  saveState(s) {
    writeJson(this.stateFile, s);
  }

  isSeen(key) {
    const s = this.loadState();
    return Boolean(s.seen[key]);
  }

  markSeen(key) {
    const s = this.loadState();
    s.seen[key] = nowIso();
    // 控制 seen 体积，只保留最近 1000 条
    const keys = Object.keys(s.seen);
    if (keys.length > 1000) {
      for (const k of keys.slice(0, keys.length - 1000)) delete s.seen[k];
    }
    this.saveState(s);
  }
}
