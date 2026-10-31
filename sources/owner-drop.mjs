// 来源④：主人单独投放的表情包。
// 监听投放文件夹（设置页可配），新图自动去重入库；主人的图默认信任 approved，
// 但仍过名称黑名单（命中则 blocked）。私信发图由 index 层在收到 dm 图片时调用同一入库逻辑。
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { listFilesRecursive, isImageFile, nowIso } from '../lib/util.mjs';

export function defaultOwnerDropDir() {
  return join(homedir(), '.dsh', 'dfy-bqb', 'owner-drop');
}

/**
 * 扫描投放文件夹，把新图入库
 * @param {object} store BqbStore
 * @param {string} dropDir 投放目录
 * @param {object} opts { emotion, tags }
 */
export function scanOwnerDrop(store, dropDir, opts = {}) {
  const dir = dropDir || defaultOwnerDropDir();
  if (!existsSync(dir)) return { dir, added: [], duplicates: [], errors: [] };

  const added = [];
  const duplicates = [];
  const errors = [];

  for (const file of listFilesRecursive(dir).filter(isImageFile)) {
    const r = store.ingestImage({
      imagePath: file,
      source: 'owner',
      emotion: opts.emotion || 'daily',
      tags: opts.tags || ['owner'],
      keywords: ['主人投放'],
      caption: '主人投放',
      autoApprove: true, // 主人信任，直接可发
      sourceRef: file,
    });
    if (r.duplicated) duplicates.push(r.sticker.id);
    else if (r.sticker) added.push(r.sticker.id);
    else errors.push({ file, reason: r.reason });
  }
  return { dir, added, duplicates, errors, scannedAt: nowIso() };
}
