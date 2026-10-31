// 形态决策：根据场景概率与风控余量，决定纯文字 / 纯表情 / 文字+表情。
// 先查风控上限，超限一律纯文字；概率决定是否带表情，再决定是否纯表情。
import { chance } from './util.mjs';

export function decideForm({
  scene, emotionResult, config, store, peer,
}) {
  const isDm = scene === 'dm';
  const stickerChance = isDm ? config.dmStickerChance : config.commentStickerChance;
  const pureChance = isDm ? config.dmPureStickerChance : config.commentPureStickerChance;

  // 风控：每日总量 / 同对象上限，超限不带表情
  const dailyTotal = store.dailyStickerCount();
  const peerTotal = store.peerDailyCount(peer);
  const overDaily = dailyTotal >= config.dailyStickerLimit;
  const overPeer = peerTotal >= config.perPeerStickerLimit;

  if (overDaily || overPeer) {
    return { mode: 'text', reason: overDaily ? '每日贴纸上限' : '同对象贴纸上限' };
  }

  // 不确定/负面强情绪在评论区更保守，降低纯表情概率
  if (!chance(stickerChance)) {
    return { mode: 'text', reason: '概率未命中带表情' };
  }

  if (chance(pureChance)) {
    return { mode: 'sticker', reason: '概率命中纯表情' };
  }
  return { mode: 'text+sticker', reason: '默认文字+表情' };
}
