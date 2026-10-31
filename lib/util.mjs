// 公共工具：零依赖，只用 Node 内置模块
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, extname, basename } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function nowIso() {
  return new Date().toISOString();
}

export function todayStr(d = new Date()) {
  // 本地日期 YYYY-MM-DD，用于每日计数
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 默认数据目录：~/.dsh/dfy-bqb
export function resolveDataDir(configured) {
  if (configured && configured.trim()) return resolve(configured.trim());
  return join(homedir(), '.dsh', 'dfy-bqb');
}

export function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

// 原子读 JSON：不存在返回 fallback；文件损坏直接抛错（fail-loud，不静默吞）
export function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  const raw = readFileSync(file, 'utf8');
  if (!raw.trim()) return fallback;
  return JSON.parse(raw);
}

// 原子写 JSON：先写临时文件再 rename，避免写一半崩溃损坏索引
export function writeJson(file, data) {
  ensureDir(dirname(file));
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmp, file);
  return file;
}

// 计算文件内容 hash（去重用）
export function fileHash(file) {
  const buf = readFileSync(file);
  return createHash('sha256').update(buf).digest('hex');
}

export function sha256Text(text) {
  return createHash('sha256').update(String(text)).digest('hex');
}

export function pickRandom(arr, rng = Math.random) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(rng() * arr.length)];
}

// 稳定排序的随机抽样：避免连续两次挑到同一张
export function pickRandomExcept(arr, exceptId, rng = Math.random) {
  const pool = (arr || []).filter((x) => x.id !== exceptId);
  return pickRandom(pool.length ? pool : arr, rng);
}

export function listFilesRecursive(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...listFilesRecursive(p));
    else out.push(p);
  }
  return out;
}

export const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);

export function isImageFile(p) {
  return IMAGE_EXTS.has(extname(p).toLowerCase());
}

export function fileBaseName(p) {
  return basename(p);
}

// 简单结构化日志，带时间戳和模块名
export function log(mod, msg, extra) {
  const line = `[${nowIso()}] [${mod}] ${msg}`;
  if (extra !== undefined) {
    // eslint-disable-next-line no-console
    console.log(line, typeof extra === 'string' ? extra : JSON.stringify(extra));
  } else {
    // eslint-disable-next-line no-console
    console.log(line);
  }
}

// 简单的内存计数器持久化结构合并
export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}
