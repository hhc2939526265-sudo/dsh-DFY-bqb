// 内容情绪识别：对「输入消息/评论」做情绪 + 意图判定。
// 注意与底座 mood.mjs 的区别：mood 是大肥鱼自己的心情，这里是理解「对方发来的内容」。
// 两层：规则引擎（无 LLM 也能跑的基线）+ LLM 结构化结果（可修正基线，最终仍要过 emotion-gate）。

export const EMOTIONS = ['happy', 'sad', 'angry', 'shy', 'confused', 'daily'];

// 情绪桶效价（-1 负向 ~ +1 正向）与唤醒（0 平静 ~ 1 激烈）
export const EMOTION_PROFILE = {
  happy: { valence: 0.85, arousal: 0.65 },
  sad: { valence: -0.7, arousal: 0.35 },
  angry: { valence: -0.75, arousal: 0.9 },
  shy: { valence: 0.25, arousal: 0.4 },
  confused: { valence: -0.15, arousal: 0.5 },
  daily: { valence: 0.05, arousal: 0.25 },
};

// 场景意图
export const INTENTS = [
  'greet', 'congratulate', 'comfort', 'apologize', 'praise',
  'complain', 'tease', 'question', 'thanks', 'farewell', 'neutral',
];

// 规则词典：命中即给对应情绪加权（权重越高越主导）
const KEYWORD_RULES = [
  {
    emotion: 'happy',
    weight: 2,
    words: [
      '哈哈', '哈哈哈', '嘿嘿', '嘻嘻', '好开心', '开心', '高兴', '快乐', '笑死', '笑不活了',
      '太棒了', '太好了', '好耶', '耶', '欢喜', '兴奋', '激动', '爽', '美滋滋', '乐呵呵',
      '可爱', '喜欢', '爱了', '绝了', '绝绝子', '真香', '好评', '点赞', '牛', '厉害', '666',
    ],
  },
  {
    emotion: 'sad',
    weight: 2,
    words: [
      '难过', '伤心', '委屈', '哭', '呜呜', '想哭', '泪', '失落', '低落', '沮丧', '心碎',
      '不开心', '难受', '痛苦', '悲伤', '郁闷', 'emo', '抑郁', '惨', '可怜', '孤独', '寂寞',
      '失望', '怕', '害怕', '担心', '焦虑', '紧张', '压力大', '崩溃',
    ],
  },
  {
    emotion: 'angry',
    weight: 2,
    words: [
      '生气', '愤怒', '气死', '气死我了', '怒', '恼火', '火大', '发火', '讨厌', '烦人',
      '恶心', '垃圾', '差评', '投诉', '举报', '过分', '离谱', '无耻', '混蛋', '滚', '闭嘴',
      '受不了', '忍不了', '凭什么', '可恶', '炸了', '暴怒',
    ],
  },
  {
    emotion: 'shy',
    weight: 1.5,
    words: [
      '害羞', '不好意思', '脸红', '羞', '么么', '亲亲', '抱抱', '贴贴', '撒娇', '人家',
      '讨厌啦', '嘤嘤', '喵', '乖', '摸摸头',
    ],
  },
  {
    emotion: 'confused',
    weight: 1.5,
    words: [
      '？', '?', '什么', '为啥', '为什么', '怎么', '咋', '难道', '不懂', '不清楚', '疑惑',
      '纳闷', '懵', '懵了', '蒙圈', '迷茫', '奇怪', '真的假的', '啥意思', '确定吗',
    ],
  },
];

// 意图关键词（在情绪判定之后做意图补充）
const INTENT_RULES = [
  { intent: 'greet', words: ['你好', '在吗', '哈喽', '嗨', '早', '晚上好', '下午好', 'hi', 'hello'] },
  { intent: 'congratulate', words: ['恭喜', '祝贺', '生日快乐', '新年快乐', '中奖', '升职', '考上', '脱单'] },
  { intent: 'comfort', words: ['别难过', '没事的', '加油', '会好的', '抱抱你', '别担心', '陪你', '挺住'] },
  { intent: 'apologize', words: ['对不起', '抱歉', '不好意思', '我错了', '见谅', '赔罪'] },
  { intent: 'praise', words: ['厉害', '牛', '优秀', '做得好', '佩服', '大神', '专业', '靠谱'] },
  { intent: 'complain', words: ['差评', '投诉', '退款', '质量差', '坏了', '不好用', '不满意', '坑'] },
  { intent: 'tease', words: ['傻', '笨', '呆', '逗', '调皮', '恶搞', '整蛊', '哈哈你'] },
  { intent: 'question', words: ['吗', '呢', '怎么', '为什么', '哪里', '哪个', '多少', '是不是', '能不能'] },
  { intent: 'thanks', words: ['谢谢', '感谢', '多谢', '辛苦', 'thx', 'thanks'] },
  { intent: 'farewell', words: ['再见', '拜拜', '晚安', '先走了', '下次聊', 'bye'] },
];

function normalize(text) {
  return String(text || '').toLowerCase();
}

// 规则引擎基线
export function analyzeByRules(text) {
  const content = normalize(text);
  const scores = Object.fromEntries(EMOTIONS.map((e) => [e, 0]));
  const hits = {};

  for (const rule of KEYWORD_RULES) {
    for (const w of rule.words) {
      if (content.includes(w.toLowerCase())) {
        scores[rule.emotion] += rule.weight;
        hits[w] = (hits[w] || 0) + 1;
      }
    }
  }

  let primary = 'daily';
  let secondary = null;
  let best = 0;
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (ranked[0][1] > 0) {
    primary = ranked[0][0];
    best = ranked[0][1];
    if (ranked[1][1] > 0 && ranked[1][1] >= best * 0.6) secondary = ranked[1][0];
  }

  let intent = 'neutral';
  for (const r of INTENT_RULES) {
    if (r.words.some((w) => content.includes(w.toLowerCase()))) {
      intent = r.intent;
      break;
    }
  }

  const profile = EMOTION_PROFILE[primary];
  return {
    primary,
    secondary,
    intent,
    valence: profile.valence,
    arousal: profile.arousal,
    matchedKeywords: Object.keys(hits),
    source: 'rules',
  };
}

// 给 LLM 的结构化提示（值班轮使用）
export function buildEmotionPrompt(text, context = {}) {
  return [
    '你是大肥鱼的情绪理解模块。判断下面这条抖音消息/评论的情绪，只输出 JSON，不要解释。',
    `场景：${context.scene || 'dm'}，对象：${context.peer || '未知'}`,
    `可选情绪：${EMOTIONS.join(' / ')}`,
    `可选意图：${INTENTS.join(' / ')}`,
    '输出格式：{"primary": "...", "secondary": "...或null", "intent": "...", "valence": -1到1, "arousal": 0到1}',
    '规则：主情绪只能从可选情绪里选；拿不准 primary 用 daily；复合情绪再给 secondary。',
    `消息内容：${text}`,
  ].join('\n');
}

// 解析并校验 LLM 结果，非法字段回退到规则引擎（fail-closed）
export function mergeLlmResult(text, llmJson) {
  const baseline = analyzeByRules(text);
  if (!llmJson || typeof llmJson !== 'object') return baseline;
  if (!EMOTIONS.includes(llmJson.primary)) return baseline;
  if (llmJson.intent && !INTENTS.includes(llmJson.intent)) return baseline;

  const profile = EMOTION_PROFILE[llmJson.primary];
  return {
    primary: llmJson.primary,
    secondary: EMOTIONS.includes(llmJson.secondary) ? llmJson.secondary : null,
    intent: llmJson.intent || baseline.intent,
    valence: typeof llmJson.valence === 'number' ? llmJson.valence : profile.valence,
    arousal: typeof llmJson.arousal === 'number' ? llmJson.arousal : profile.arousal,
    matchedKeywords: baseline.matchedKeywords,
    source: 'llm',
  };
}

// 统一入口：有 llmJson 就合并，没有就规则
export function analyzeEmotion(text, llmJson = null) {
  return llmJson ? mergeLlmResult(text, llmJson) : analyzeEmotionRules(text);
}

// 规则入口别名
export function analyzeEmotionRules(text) {
  return analyzeByRules(text);
}
