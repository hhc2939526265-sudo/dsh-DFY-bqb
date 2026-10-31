// 内容情绪识别：规则引擎（关键词/标点/表情符号）基线，零依赖、可离线运行。
// 宿主提供 LLM 时可在外部用语义结果覆盖，这里保证无 LLM 也有可靠判断。
import { hashString, todayKey } from './util.mjs';

export const EMOTIONS = ['happy', 'sad', 'angry', 'shy', 'confused', 'daily'];

const LEXICON = {
  happy: [
    '哈哈', '开心', '高兴', '快乐', '嘻嘻', '棒', '厉害', '赞', '喜欢', '爱', '恭喜', '祝', '好耶',
    '开心', '美滋滋', '惊喜', '兴奋', '笑', '耶', 'nice', 'happy', '太好了', '幸福',
  ],
  sad: [
    '难过', '伤心', '哭', '失落', '沮丧', '委屈', '悲伤', '难受', '不开心', '呜呜', '泪', '遗憾',
    '心疼', '孤独', '崩溃', '失望', 'sad', '痛苦', '惨',
  ],
  angry: [
    '生气', '愤怒', '气死', '讨厌', '恶心', '烦', '过分', '垃圾', '投诉', '差评', '退钱', '骗子',
    '什么玩意', '凭什么', '无语', '恼火', 'angry', '可恨', '骂', '吼',
  ],
  shy: [
    '害羞', '不好意思', '脸红', '羞', '么么', '抱抱', '亲亲', '贴贴', '温柔', '晚安', '安慰', '摸摸',
  ],
  confused: [
    '吗', '？', '?', '怎么', '为什么', '啥', '什么', '难道', '疑惑', '不懂', '请问', '是不是', '能不能',
    '如何', '哪里', '谁', '几', 'confused',
  ],
};

const INTENT_RULES = [
  ['greet', ['你好', '在吗', '哈喽', 'hi', 'hello', '早上好', '晚上好']],
  ['congratulate', ['恭喜', '祝贺', '生日快乐', '新婚', '考上']],
  ['comfort', ['没事', '别难过', '加油', '会好', '抱抱', '安慰', '别怕']],
  ['apologize', ['对不起', '抱歉', '不好意思', '道歉']],
  ['praise', ['厉害', '棒', '优秀', '喜欢', '爱了', '好看', '赞']],
  ['complain', ['投诉', '差评', '退钱', '垃圾', '骗', '质量差']],
  ['tease', ['哈哈', '笑', '逗', '调皮', '笨蛋']],
  ['question', ['吗', '怎么', '为什么', '什么', '哪', '谁', '？', '?']],
  ['thanks', ['谢谢', '感谢', '多谢', 'thank']],
  ['farewell', ['再见', '拜拜', '晚安', '走了', '下次']],
];

const EMOJI_MAP = {
  happy: ['😀', '😁', '😄', '😆', '🥳', '😎', '😍', '🎉', '👍', '❤️'],
  sad: ['😢', '😭', '😔', '😞', '💔', '🥺'],
  angry: ['😠', '😡', '🤬', '👎'],
  shy: ['😳', '😊', '🥰', '😚'],
  confused: ['🤔', '😵', '🙄', '❓'],
};

export function analyzeByRules(text) {
  const t = String(text || '');
  const scores = Object.fromEntries(EMOTIONS.map((e) => [e, 0]));
  const hits = {};

  for (const [emo, words] of Object.entries(LEXICON)) {
    for (const w of words) {
      if (t.includes(w)) {
        scores[emo] += w.length >= 2 ? 2 : 1;
        hits[emo] = (hits[emo] || []).concat(w);
      }
    }
  }

  // 标点与表情符号
  const exclaim = (t.match(/[!！]/g) || []).length;
  const questionMarks = (t.match(/[?？]/g) || []).length;
  if (exclaim >= 2) scores.angry += 1;
  if (questionMarks) scores.confused += 1;
  for (const [emo, symbols] of Object.entries(EMOJI_MAP)) {
    for (const s of symbols) {
      if (t.includes(s)) scores[emo] += 2;
    }
  }

  // 负向词优先：同时出现正负时，按更强的负向信号
  const neg = scores.sad + scores.angry;
  const pos = scores.happy;

  let primary;
  const max = Math.max(...Object.values(scores));
  if (max === 0) {
    primary = 'daily';
  } else if (neg > pos) {
    primary = scores.angry >= scores.sad ? 'angry' : 'sad';
  } else {
    primary = Object.keys(scores).find((k) => scores[k] === max);
  }

  const intents = [];
  for (const [intent, words] of INTENT_RULES) {
    if (words.some((w) => t.includes(w))) intents.push(intent);
  }
  if (intents.length === 0) intents.push('neutral');

  return {
    primary,
    scores,
    intents,
    matched: hits,
    negative: primary === 'sad' || primary === 'angry',
    ts: new Date().toISOString(),
  };
}

// 对外统一入口：当前为规则引擎；保留相同返回结构便于 LLM 覆盖
export function analyzeEmotion(text) {
  const base = analyzeByRules(text);
  return {
    id: hashString(`${todayKey()}:${text}`).slice(0, 12),
    text: String(text || '').slice(0, 500),
    ...base,
  };
}

// 给匹配器用的意图 → 标签映射提示
export function intentTags(intents) {
  const map = {
    greet: ['wave', 'hello'],
    congratulate: ['celebrate', 'party'],
    comfort: ['hug', 'pat', 'soft'],
    apologize: ['bow', 'sorry'],
    praise: ['thumbsup', 'heart'],
    complain: ['exclaim'],
    tease: ['grin', 'wink'],
    question: ['think', 'question'],
    thanks: ['thanks', 'foldhands'],
    farewell: ['wave', 'bye'],
    neutral: ['daily'],
  };
  const out = new Set();
  for (const i of intents || []) (map[i] || []).forEach((x) => out.add(x));
  return [...out];
}
