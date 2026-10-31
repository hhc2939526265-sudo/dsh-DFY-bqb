// 情绪一致性硬闸：发送前强制校验表情情绪与消息情绪是否相容。
// 设计为 fail-closed：任何信息缺失/不明确都不放行，宁可降级纯文字也不发错。
import { EMOTIONS } from './emotion.mjs';

// 允许矩阵：消息情绪 → 可发送的表情情绪（含自身与安全中性桶）
export const BUCKET_MATRIX = {
  happy: ['happy', 'daily', 'shy'],
  sad: ['sad', 'shy', 'daily'],
  angry: ['daily', 'confused', 'shy'],
  shy: ['shy', 'happy', 'daily'],
  confused: ['confused', 'daily', 'happy'],
  daily: ['daily', 'happy', 'shy', 'confused', 'sad'],
};

// 负向场景下全局禁止的标签（防止安慰/愤怒时出现得意、挑衅、嘲讽）
const NEGATIVE_FORBIDDEN_TAGS = [
  'smug', 'provoke', 'mock', 'sarcasm', 'fury', 'rage',
];

// 负向场景下禁止的关键词（表情名/字幕里出现也拦）
const NEGATIVE_FORBIDDEN_WORDS = ['得意', '嘲讽', '嘲笑', '活该', '气死', '暴怒'];

export function validateEmotion(emotion, sticker) {
  if (!emotion || !EMOTIONS.includes(emotion)) {
    return { ok: false, reason: '消息情绪缺失或非法，fail-closed' };
  }
  if (!sticker) {
    return { ok: false, reason: '无表情，调用方应走纯文字' };
  }
  if (!sticker.emotion || !EMOTIONS.includes(sticker.emotion)) {
    return { ok: false, reason: '表情情绪字段缺失或非法，fail-closed' };
  }
  const allowed = BUCKET_MATRIX[emotion];
  if (!allowed.includes(sticker.emotion)) {
    return { ok: false, reason: `情绪桶错配：消息=${emotion}，表情=${sticker.emotion}` };
  }

  if (emotion === 'sad' || emotion === 'angry') {
    const tags = sticker.tags || [];
    const badTag = tags.find((x) => NEGATIVE_FORBIDDEN_TAGS.includes(x));
    if (badTag) return { ok: false, reason: `负向场景禁止标签：${badTag}` };
    const haystack = `${sticker.name || ''} ${sticker.caption || ''} ${tags.join(' ')}`;
    const badWord = NEGATIVE_FORBIDDEN_WORDS.find((w) => haystack.includes(w));
    if (badWord) return { ok: false, reason: `负向场景禁止词：${badWord}` };
  }
  return { ok: true };
}

// 便捷：从允许矩阵里取候选情绪桶
export function allowedBuckets(emotion) {
  return BUCKET_MATRIX[emotion] || ['daily'];
}
