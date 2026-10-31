// 情绪一致性硬闸：发送前最后一道关卡。
// 消息情绪/意图 与 候选表情的情绪桶/标签 不一致就拦截，宁可降级纯文字也不发错表情。
// 所有判定 fail-closed：表情缺字段、标签非法一律不通过。

import { EMOTIONS } from './emotion.mjs';

// 桶级兼容矩阵：消息情绪 → 允许使用的表情桶
const BUCKET_MATRIX = {
  happy: ['happy', 'shy', 'daily'],
  sad: ['sad', 'shy', 'daily'],
  angry: ['daily', 'confused', 'shy'], // 对方生气时先降温，绝不回 angry，也不回得意大笑
  shy: ['shy', 'happy', 'daily'],
  confused: ['confused', 'daily', 'happy'],
  daily: EMOTIONS.slice(),
};

// 按意图追加的禁止 tag（细粒度，命中即拦截）
const INTENT_TAG_BLOCK = {
  comfort: ['smug', 'grin', 'mock', 'laugh', 'provoke', 'sarcasm', 'angry', 'fury', 'rage'],
  apologize: ['smug', 'provoke', 'mock', 'grin', 'sarcasm', 'angry'],
  congratulate: ['sad', 'cry', 'angry', 'fury', 'provoke', 'sarcasm'],
  complain: ['smug', 'grin', 'provoke', 'sarcasm', 'laugh'],
};

// 负向情绪下永远禁止的挑衅/得意类标签
const NEGATIVE_SCENE_BLOCK = ['smug', 'provoke', 'mock', 'sarcasm', 'fury', 'rage'];

function asList(v) {
  if (!v) return [];
  return Array.isArray(v) ? v.map(String) : [String(v)];
}

/**
 * 校验候选表情是否与消息情绪一致
 * @param {{primary:string, intent:string}} emotionResult 情绪识别结果
 * @param {{emotion?:string, tags?:string[], status?:string}} sticker 候选表情
 * @returns {{ok:boolean, reason?:string}}
 */
export function checkEmotion(emotionResult, sticker) {
  if (!emotionResult || !EMOTIONS.includes(emotionResult.primary)) {
    return { ok: false, reason: '消息情绪非法，fail-closed' };
  }
  if (!sticker || typeof sticker !== 'object') {
    return { ok: false, reason: '候选表情为空' };
  }
  if (sticker.status && sticker.status !== 'approved') {
    return { ok: false, reason: `表情未审核通过（${sticker.status}）` };
  }
  if (!sticker.emotion || !EMOTIONS.includes(sticker.emotion)) {
    return { ok: false, reason: '表情缺少合法情绪桶标签' };
  }

  const allowed = BUCKET_MATRIX[emotionResult.primary] || [];
  if (!allowed.includes(sticker.emotion)) {
    return {
      ok: false,
      reason: `情绪桶错配：消息=${emotionResult.primary}，表情=${sticker.emotion}`,
    };
  }

  const tags = asList(sticker.tags).map((t) => t.toLowerCase());

  // 负向场景（sad/angry）的全局挑衅标签拦截
  if (emotionResult.primary === 'sad' || emotionResult.primary === 'angry') {
    const hit = tags.find((t) => NEGATIVE_SCENE_BLOCK.includes(t));
    if (hit) return { ok: false, reason: `负向场景命中禁止标签：${hit}` };
  }

  // 意图级标签拦截
  const block = INTENT_TAG_BLOCK[emotionResult.intent] || [];
  const hitIntent = tags.find((t) => block.includes(t));
  if (hitIntent) {
    return { ok: false, reason: `意图(${emotionResult.intent})命中禁止标签：${hitIntent}` };
  }

  return { ok: true };
}

// 批量过滤：从候选里挑出所有情绪一致的表情
export function filterByEmotion(emotionResult, stickers) {
  const passed = [];
  const rejected = [];
  for (const s of stickers || []) {
    const r = checkEmotion(emotionResult, s);
    if (r.ok) passed.push(s);
    else rejected.push({ id: s && s.id, reason: r.reason });
  }
  return { passed, rejected };
}
