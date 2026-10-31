// 回复形态决策：纯文字 text / 纯表情 sticker / 文字+表情 text+sticker。
// 概率 + 场景规则 + 风控共同决定；任何不确定或超限都退回 text（fail-safe）。

export const MODES = ['text', 'sticker', 'text+sticker'];

/**
 * @param {object} emotionResult 情绪识别结果
 * @param {'dm'|'comment'} scene 场景
 * @param {object} config 配置（各 chance 与上限）
 * @param {{daily:number, perPeer:number}} counts 当前计数
 * @param {() => number} rng 可注入随机
 */
export function decideMode(emotionResult, scene, config, counts, rng = Math.random) {
  const isComment = scene === 'comment';
  const stickerChance = isComment ? config.commentStickerChance : config.dmStickerChance;
  const pureChance = isComment ? config.commentPureStickerChance : config.dmPureStickerChance;

  // 风控：达到每日或同人上限，强制纯文字
  if (counts.daily >= config.dailyStickerLimit) {
    return { mode: 'text', reason: '达到每日贴纸上限' };
  }
  if (counts.perPeer >= config.perPeerStickerLimit) {
    return { mode: 'text', reason: '达到同对象贴纸上限' };
  }

  // 对方正在愤怒：纯表情容易火上浇油，只允许文字或文字+表情，禁止纯表情
  if (emotionResult.primary === 'angry') {
    const roll = rng();
    if (roll < stickerChance) return { mode: 'text+sticker', reason: '愤怒场景仅文字+温和表情' };
    return { mode: 'text', reason: '愤怒场景默认纯文字' };
  }

  // 安慰场景：倾向文字+表情
  if (emotionResult.intent === 'comfort' || emotionResult.primary === 'sad') {
    const roll = rng();
    if (roll < Math.max(stickerChance, 0.5)) {
      return { mode: 'text+sticker', reason: '安慰场景文字+温暖表情' };
    }
    return { mode: 'text', reason: '安慰场景纯文字' };
  }

  const roll = rng();
  // 纯表情（评论区默认 pureChance=0，即不发纯图片评论）
  if (roll < pureChance) return { mode: 'sticker', reason: '随机命中纯表情' };
  if (roll < pureChance + stickerChance) return { mode: 'text+sticker', reason: '随机命中文字+表情' };
  return { mode: 'text', reason: '随机命中纯文字' };
}
