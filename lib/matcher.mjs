// 语义匹配：替代底座「按 tag 随机挑」的 pickSticker。
// 先过情绪一致性闸，再按关键词/意图/使用历史打分，挑最贴合内容的表情；无候选返回 null（降级纯文字）。
import { filterByEmotion } from './emotion-gate.mjs';
import { pickRandom } from './util.mjs';

// 意图 → 偏好细标签
const INTENT_TAGS = {
  greet: ['wave', 'hello', 'hi'],
  congratulate: ['celebrate', 'cheer', 'party', 'trophy'],
  comfort: ['hug', 'pat', 'soft', 'tissue'],
  apologize: ['bow', 'sorry', 'apologize'],
  praise: ['thumbsup', 'like', 'star'],
  complain: ['listen', 'pat', 'soft'],
  tease: ['playful', 'grin', 'wink'],
  question: ['think', 'confused', 'question'],
  thanks: ['thanks', 'flower', 'heart'],
  farewell: ['wave', 'bye'],
  neutral: [],
};

function tokenize(emotionResult) {
  const tokens = new Set();
  for (const k of emotionResult.matchedKeywords || []) tokens.add(k.toLowerCase());
  return tokens;
}

// 单张表情语义打分（纯函数，便于单测）
export function scoreSticker(emotionResult, sticker) {
  let score = 0;
  const msgTokens = tokenize(emotionResult);
  const kw = (sticker.keywords || []).map((s) => s.toLowerCase());
  const tags = (sticker.tags || []).map((s) => s.toLowerCase());
  const cap = String(sticker.caption || '').toLowerCase();

  // 关键词命中
  for (const t of msgTokens) {
    if (kw.includes(t)) score += 3;
    if (tags.includes(t)) score += 2;
    if (cap.includes(t)) score += 1;
  }

  // 意图偏好标签
  const prefer = INTENT_TAGS[emotionResult.intent] || [];
  for (const p of prefer) {
    if (tags.includes(p)) score += 4;
    if (kw.includes(p)) score += 2;
  }

  // 情绪桶精确匹配给基础分
  if (sticker.emotion === emotionResult.primary) score += 2;

  // 多样性：用得越多越降权，避免老发同一张
  score -= Math.min((sticker.useCount || 0) * 0.3, 2);

  return score;
}

/**
 * 选出最贴合内容的表情
 * @returns {{sticker:object|null, candidates:Array, rejected:Array}}
 */
export function matchSticker(emotionResult, store, rng = Math.random) {
  const approved = store.listApproved();
  const { passed, rejected } = filterByEmotion(emotionResult, approved);
  if (passed.length === 0) return { sticker: null, candidates: [], rejected };

  const scored = passed
    .map((s) => ({ s, score: scoreSticker(emotionResult, s) }))
    .sort((a, b) => b.score - a.score);

  const top = scored[0].score;
  // 同分（含接近分）放入随机池，保证不机械重复
  const pool = scored.filter((x) => x.score >= top - 0.5).map((x) => x.s);
  return { sticker: pickRandom(pool, rng), candidates: scored, rejected };
}
