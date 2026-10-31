// 来源②：基于表情库已有表情二创（加字幕魔改）。
// 默认用 Pillow helper（中文可靠）；保留 ffmpeg 探测作为信息。二创结果默认 pending 待审核。
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDir, nowIso } from '../lib/util.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export function hasFfmpeg() {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-version']);
    p.on('error', () => resolve(false));
    p.on('exit', (code) => resolve(code === 0));
  });
}

function runPython(args) {
  return new Promise((resolve, reject) => {
    const py = spawn('python', args);
    let out = '';
    let err = '';
    py.stdout.on('data', (c) => { out += c; });
    py.stderr.on('data', (c) => { err += c; });
    py.on('error', reject);
    py.on('exit', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err || `exit ${code}`))));
  });
}

/**
 * 给底图加字幕生成二创
 * @param {object} opts { baseImage, topText, bottomText, workDir }
 * @returns {Promise<{path:string, base:string, createdAt:string}>}
 */
export async function deriveCaption({ baseImage, topText = '', bottomText = '', workDir }) {
  if (!existsSync(baseImage)) throw new Error(`底图不存在：${baseImage}`);
  const dir = ensureDir(join(workDir, 'derive-cache'));
  const { name } = parse(baseImage);
  const out = join(dir, `derive_${Date.now()}_${name}.png`);
  const helper = join(__dirname, 'caption_helper.py');
  await runPython([helper, baseImage, out, topText || ' ', bottomText || ' ']);
  if (!existsSync(out)) throw new Error('二创输出文件未生成');
  return { path: out, base: baseImage, createdAt: nowIso() };
}

// 入库：source=derive，继承底图情绪，默认 pending
export function ingestDerived(store, derived, emotion, extraTags = []) {
  return store.ingestImage({
    imagePath: derived.path, source: 'derive', emotion: emotion || 'daily',
    tags: [...extraTags, 'derived'], autoApprove: false, sourceRef: derived.base,
  });
}
