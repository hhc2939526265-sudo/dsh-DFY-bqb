// 公共工具：路径、hash、重试、随机延迟、日志。零依赖，仅用 node 内置模块。
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';

export function fileHash(p) {
  const buf = readFileSync(p);
  return createHash('sha256').update(buf).digest('hex');
}

export function hashString(s) {
  return createHash('sha256').update(String(s)).digest('hex');
}

export function nowIso() {
  return new Date().toISOString();
}

export function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function resolveDataDir(dir) {
  if (dir && isAbsolute(dir)) return dir;
  if (dir) return join(process.cwd(), dir);
  return join(homedir(), '.dsh', 'dfy-bqb');
}

// 带重试的异步执行：仅对可重试错误重试，指数退避加抖动
export async function withRetry(fn, { retries = 3, baseMs = 300, label = 'op' } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await fn(attempt);
    } catch (e) {
      lastErr = e;
      if (!e.retryable || attempt === retries) break;
      const delay = baseMs * (2 ** attempt) + Math.floor(Math.random() * baseMs);
      // eslint-disable-next-line no-await-in-loop, no-console
      console.log(`[${label}] 第 ${attempt + 1} 次失败，${delay}ms 后重试：${e.message}`);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// 拟人随机延迟（毫秒）
export function humanDelayMs(min = 1200, max = 4500) {
  return Math.floor(min + Math.random() * (max - min));
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function log(mod, msg, extra) {
  const line = `[${nowIso()}] [${mod}] ${msg}`;
  // eslint-disable-next-line no-console
  console.log(extra ? `${line} ${JSON.stringify(extra)}` : line);
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function chance(p) {
  return Math.random() < p;
}
