// 安全与拟人节奏：判断内容是否值得回复，以及发送前的拟人延迟。
// 恶意攻击、广告引流、色情等一律不回，避免大肥鱼被利用或卷入冲突。

const HARD_BLOCK_PATTERNS = [
  { re: /(加微|加v|vx[:：]|微信[:：]|兼职|刷单|日赚|月入\s*\d+|免费领|点击链接|http[s]?:\/\/\S*?(返利|红包|薅羊毛))/i, reason: '广告/引流' },
  { re: /(约炮|一夜情|裸聊|上门|包养|色情|av\b|黄片)/i, reason: '色情/违规' },
  { re: /(傻逼|草泥马|杀了你|去死|废物|脑残|狗东西|贱)/, reason: '恶意攻击' },
  { re: /(赌博|博彩|彩票预测|六合彩|赌球|棋牌下载)/, reason: '赌博' },
];

// 刷屏/无意义内容：连续重复字符或超长重复
function isSpam(text) {
  const t = String(text || '').trim();
  if (t.length < 2) return { spam: true, reason: '内容过短/空' };
  const sameChar = /(.)\1{8,}/.test(t);
  if (sameChar) return { spam: true, reason: '重复刷屏' };
  return { spam: false };
}

export function isSafeToReply(content) {
  const text = String(content || '');
  for (const p of HARD_BLOCK_PATTERNS) {
    if (p.re.test(text)) return { ok: false, reason: p.reason };
  }
  const sp = isSpam(text);
  if (sp.spam) return { ok: false, reason: sp.reason };
  return { ok: true };
}

// 拟人延迟：回复前随机等待，避免秒回机器感
export function humanDelay(rng = Math.random) {
  // 1.5 ~ 6 秒
  return Math.round(1500 + rng() * 4500);
}
