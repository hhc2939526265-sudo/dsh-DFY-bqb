// 运行时默认配置与合并：patch/设置页传入的字段覆盖默认值，缺失字段用安全默认。
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
  doubao: {
    enabled: false,
    exePath: '',
    downloadDir: '',
    timeoutSec: 180,
  },
  webSearch: {
    enabled: true,
    maxCandidates: 8,
  },
  derive: {
    enabled: true,
  },
  pollIntervalSec: 60,
};

// 浅合并 + 嵌套对象合并（doubao/webSearch/derive）
function mergeNested(base, override, keys) {
  const out = { ...base };
  for (const k of keys) {
    out[k] = { ...(base[k] || {}), ...((override && override[k]) || {}) };
  }
  return out;
}

export function mergeConfig(override = {}) {
  const merged = mergeNested(DEFAULT_CONFIG, override, ['doubao', 'webSearch', 'derive']);
  for (const [k, v] of Object.entries(override)) {
    if (v !== undefined && !['doubao', 'webSearch', 'derive'].includes(k)) merged[k] = v;
  }
  // 概率字段夹到 0..1，避免设置页填错
  for (const k of [
    'dmStickerChance', 'dmPureStickerChance',
    'commentStickerChance', 'commentPureStickerChance',
  ]) {
    merged[k] = Math.min(1, Math.max(0, Number(merged[k]) || 0));
  }
  return merged;
}
