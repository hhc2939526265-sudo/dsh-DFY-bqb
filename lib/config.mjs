// 默认配置与合并：用户配置覆盖默认值，做基本类型与范围校验。
import { homedir } from 'node:os';
import { join } from 'node:path';
import { clamp } from './util.mjs';

export const DEFAULT_CONFIG = {
  enabled: true,
  basePath: '',
  offline: false,
  dataDir: '',
  ownerDropDir: '',
  enableDm: true,
  enableComment: true,
  dmStickerChance: 0.45,
  dmPureStickerChance: 0.15,
  commentStickerChance: 0.3,
  commentPureStickerChance: 0,
  dailyStickerLimit: 5,
  perPeerStickerLimit: 2,
  pollIntervalSec: 60,
  webSearch: { enabled: true, maxCandidates: 8 },
  derive: { enabled: true },
  doubao: { enabled: false, exePath: '', downloadDir: '', timeoutSec: 180 },
};

function num(v, fallback, min, max) {
  if (typeof v !== 'number' || Number.isNaN(v)) return fallback;
  return clamp(v, min, max);
}

function mergeSection(base, override) {
  if (!override || typeof override !== 'object') return { ...base };
  return { ...base, ...override };
}

export function mergeConfig(user = {}) {
  const out = {
    ...DEFAULT_CONFIG,
    ...user,
    webSearch: mergeSection(DEFAULT_CONFIG.webSearch, user.webSearch),
    derive: mergeSection(DEFAULT_CONFIG.derive, user.derive),
    doubao: mergeSection(DEFAULT_CONFIG.doubao, user.doubao),
  };
  out.dmStickerChance = num(user.dmStickerChance, DEFAULT_CONFIG.dmStickerChance, 0, 1);
  out.dmPureStickerChance = num(user.dmPureStickerChance, DEFAULT_CONFIG.dmPureStickerChance, 0, 1);
  out.commentStickerChance = num(user.commentStickerChance, DEFAULT_CONFIG.commentStickerChance, 0, 1);
  out.commentPureStickerChance = num(user.commentPureStickerChance, DEFAULT_CONFIG.commentPureStickerChance, 0, 1);
  out.dailyStickerLimit = num(user.dailyStickerLimit, DEFAULT_CONFIG.dailyStickerLimit, 0, 100);
  out.perPeerStickerLimit = num(user.perPeerStickerLimit, DEFAULT_CONFIG.perPeerStickerLimit, 0, 100);
  out.pollIntervalSec = num(user.pollIntervalSec, DEFAULT_CONFIG.pollIntervalSec, 15, 3600);
  out.defaultOwnerDrop = join(homedir(), '.dsh', 'dfy-bqb', 'owner-drop');
  return out;
}
