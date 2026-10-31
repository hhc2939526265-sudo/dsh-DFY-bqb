// 来源①：大肥鱼自主在网上搜寻表情包。
// 走公开图片搜索（Bing 图片）页面解析出原图地址，下载后入库，默认 pending 待审核。
// 零依赖：Node 22 内置 fetch。受反爬/网络限制时如实报错，不静默伪造结果。
import { writeFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { ensureDir, fileHash, isImageFile, nowIso } from '../lib/util.mjs';

const BING_IMG = 'https://www.bing.com/images/search';
const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

// 从 Bing 结果页提取原图 URL（murl 字段）
export function parseImageUrls(html, limit) {
  const urls = [];
  const re = /murl&quot;:&quot;(.*?)&quot;/g;
  let m;
  while ((m = re.exec(html)) && urls.length < limit) {
    const u = m[1].replace(/\\\//g, '/');
    if (/^https?:\/\//.test(u) && !urls.includes(u)) urls.push(u);
  }
  return urls;
}

async function download(url, dest, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(dest, buf);
    return buf.length;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 搜索并下载表情包
 * @param {object} opts { query, emotion, workDir, maxCandidates, timeoutMs }
 */
export async function searchAndDownload({
  query, emotion = 'daily', workDir, maxCandidates = 8, timeoutMs = 20000,
}) {
  const dir = ensureDir(join(workDir, 'web-cache'));
  const url = `${BING_IMG}?q=${encodeURIComponent(`${query} 表情包`)}&form=HDRSC2`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`图片搜索失败 HTTP ${res.status}`);
  const html = await res.text();
  const imageUrls = parseImageUrls(html, maxCandidates);

  const downloaded = [];
  const errors = [];
  for (let i = 0; i < imageUrls.length; i += 1) {
    const u = imageUrls[i];
    const ext = (extname(new URL(u).pathname).toLowerCase().split('?')[0]) || '.jpg';
    if (!ALLOWED_EXT.includes(ext)) continue;
    const tmp = join(dir, `web_${Date.now()}_${i}${ext}`);
    try {
      const size = await download(u, tmp, timeoutMs);
      if (existsSync(tmp) && isImageFile(tmp) && size > 0) {
        downloaded.push({ path: tmp, url: u, hash: fileHash(tmp) });
      }
    } catch (e) {
      errors.push({ url: u, error: e.message });
    }
  }
  return { query, emotion, downloaded, errors, fetchedAt: nowIso };
}

// 把下载结果交给 store 入库（默认 pending，审核通过才能发）
export function ingestDownloads(store, batch, tags = []) {
  const result = [];
  for (const d of batch.downloaded) {
    const r = store.ingestImage({
      imagePath: d.path, source: 'web-search', emotion: batch.emotion,
      tags: [...tags, batch.query], keywords: [batch.query], caption: batch.query,
      sourceRef: d.url, autoApprove: false,
    });
    result.push(r);
  }
  return result;
}
