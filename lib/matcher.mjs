// 语义匹配：在情绪一致的 approved 候选里，按关键词、意图标签、使用历史打分挑选。
// 不随机：优先未用过/少用的，命中文本关键词或意图标签的加权，避免老发同一张。
import { allowedBuckets } from './emotion-gate.mjs';
import { intentTags } from './emotion.mjs';

export function scoreSticker(sticker, emotion, text, intentTagSet) {
  let score = 0;
  const t = String(text || '');
  // 关键词命中
  for (const kw of sticker.keywords || []) {
    if (t.includes(kw)) score += 5;
  }
  // 意图标签命中
  for (const tag of sticker.tags || []) {
    if (intentTagSet.has(tag)) score += 3;
  }
  // 同情绪桶精准命中加分
  if (sticker.emotion === emotion) score += 2;
  // 少用优先：用得越多分越低，lastUsed 越久越优先
  score -= Math.min(sticker.useCount || 0, 10) * 0.5;
  // 轻微随机抖动，避免并列时永远选同一张
  score += Math.random() * 0.8;
  return score;
}

export function matchSticker(emotionResult, store, opts = {}) {
  const emotion = emotionResult.primary;
  const buckets = allowedBuckets(emotion);
  const intentTagSet = new Set(intentTags(emotionResult.intents));
  const candidates = store.listApproved().filter((s) => buckets.includes(s.emotion));

  const rejected = [];
  if (candidates.length === 0) {
    return { sticker: null, score: 0, rejected, reason: '无情绪一致候选' };
  }

  let best = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    // 排除外部传入的额外限制（如标签黑名单）
    if (opts.excludeTags && opts.excludeTags.some((x) => (c.tags || []).includes(x))) {
      rejected.push({ id: c.id, reason: `标签被排除` });
      continue;
    }
    const s = scoreSticker(c, emotion, emotionResult.text, intentTagSet);
    if (s > bestScore) {
      best = c;
      bestScore = s;
    }
  }
  return { sticker: best, score: bestScore, rejected };
}
