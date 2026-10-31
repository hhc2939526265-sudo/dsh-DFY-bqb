// 安全判断与拟人延迟：广告/恶意/刷屏检测，安全文本才回复；发送前随机延迟。
import { humanDelayMs } from './util.mjs';

const AD_PATTERNS = [
  /加(微|v|vx|vx|q|qq)/i, /(免费|低价|优惠|折扣|代刷|代练|刷赞|刷粉)/,
  /(http|https|www\.)/i, /(加我|私聊|vx|微信|qq群|q群)/i,
  /(返现|红包|兼职|日结|点赞员)/, /(彩票|赌博|博彩|棋牌|下注)/,
];

const ABUSE_PATTERNS = [
  /(傻逼|草泥马|滚|去死|废物|贱人|婊|狗东西)/,
];

// 刷屏：连续重复字符/重复短语占比过高
export function looksLikeFlood(text) {
  const t = String(text || '');
  if (t.length < 8) return false;
  const chars = {};
  for (const ch of t) chars[ch] = (chars[ch] || 0) + 1;
  const maxRepeat = Math.max(...Object.values(chars));
  if (maxRepeat / t.length > 0.6) return true;
  // 重复短语：同一 3 字片段出现多次
  const grams = {};
  for (let i = 0; i + 3 <= t.length; i += 1) {
    const g = t.slice(i, i + 3);
    grams[g] = (grams[g] || 0) + 1;
  }
  return Object.values(grams).some((n) => n >= 4);
}

export function assessSafety(text) {
  const t = String(text || '');
  if (!t.trim()) return { safe: false, reason: 'empty' };
  if (ABUSE_PATTERNS.some((p) => p.test(t))) return { safe: false, reason: 'abuse' };
  if (AD_PATTERNS.some((p) => p.test(t))) return { safe: false, reason: 'ad' };
  if (looksLikeFlood(t)) return { safe: false, reason: 'flood' };
  return { safe: true };
}

export function preSendDelay() {
  return humanDelayMs(1200, 4500);
}
