// 编排引擎：把「安全判断 → 情绪分析 → 形态决策 → 语义匹配 → 情绪闸 → 拟人延迟 → 发送 → 计数」
// 串成完整闭环。与 Cordis 解耦，可在 selfcheck 中离线直接测试。
import { analyzeEmotion, buildEmotionPrompt } from './emotion.mjs';
import { checkEmotion } from './emotion-gate.mjs';
import { decideMode } from './decision.mjs';
import { matchSticker } from './matcher.mjs';
import { isSafeToReply, humanDelay } from './ratelimit.mjs';
import { sleep, sha256Text, nowIso } from './util.mjs';

export class BqbEngine {
  /**
   * @param {object} config 合并后的配置
   * @param {object} deps { store, mcp, llmHook, logger, rng }
   */
  constructor(config, deps) {
    this.config = config;
    this.store = deps.store;
    this.mcp = deps.mcp;
    // llmHook: async ({text, scene, peer}) => llmJson 或 null，由 DSH 值班轮注入
    this.llmHook = deps.llmHook || null;
    this.logger = deps.logger || (() => {});
    this.rng = deps.rng || Math.random;
  }

  // 单条消息/评论的完整处理
  async processIncoming({ scene, text, peer = '', key = '', dryRun = false }) {
    const seenKey = key || `${scene}:${peer}:${sha256Text(text).slice(0, 10)}`;
    if (this.store.isSeen(seenKey)) {
      return { skipped: true, reason: '已处理过', seenKey };
    }

    const safe = isSafeToReply(text);
    if (!safe.ok) {
      this.store.markSeen(seenKey);
      return { skipped: true, reason: `安全拦截：${safe.reason}`, seenKey };
    }

    // 1. 情绪分析：规则基线，LLM 可选修正
    let llmJson = null;
    if (this.llmHook) {
      try { llmJson = await this.llmHook({ text, scene, peer }); } catch (e) {
        this.logger('llm-hook-failed', e.message);
      }
    }
    const emotionResult = analyzeEmotion(text, llmJson);

    // 2. 形态决策
    const counts = {
      daily: this.store.dailyStickerCount(),
      perPeer: this.store.dailyStickerCount(peer),
    };
    const modeDecision = decideMode(emotionResult, scene, this.config, counts, this.rng);

    // 3. 语义匹配（内部已过情绪闸）
    let sticker = null;
    let matchInfo = null;
    if (modeDecision.mode !== 'text') {
      matchInfo = matchSticker(emotionResult, this.store, this.rng);
      sticker = matchInfo.sticker;
      // 双保险：发送前再独立校验一次
      if (sticker) {
        const gate = checkEmotion(emotionResult, sticker);
        if (!gate.ok) {
          this.logger('emotion-gate-block', gate.reason);
          sticker = null;
        }
      }
      // 匹配不到情绪一致的表情，降级纯文字
      if (!sticker && modeDecision.mode === 'sticker') {
        modeDecision.mode = 'text';
        modeDecision.reason = '无情绪一致表情，降级纯文字';
      }
    }

    // 4. 拟人延迟（dry-run 跳过等待）
    if (!dryRun) await sleep(humanDelay(this.rng));

    // 5. 发送
    const sendResult = await this.send({
      scene, peer, text, mode: modeDecision.mode, sticker, emotionResult, dryRun,
    });

    // 6. 标记与计数：seen 去重标记即使 dryRun 也写（与安全拦截分支一致）；
    //    使用次数/每日计数属于发送副作用，仅真实发送（非 dryRun）时更新。
    this.store.markSeen(seenKey);
    if (!dryRun && sticker) {
      this.store.recordUse(sticker.id);
      this.store.incrementDaily(peer);
    }

    return {
      skipped: false,
      seenKey,
      emotion: {
        primary: emotionResult.primary,
        secondary: emotionResult.secondary,
        intent: emotionResult.intent,
        source: emotionResult.source,
      },
      mode: modeDecision.mode,
      modeReason: modeDecision.reason,
      sticker: sticker ? { id: sticker.id, emotion: sticker.emotion, tags: sticker.tags } : null,
      send: sendResult,
      at: nowIso(),
    };
  }

  // 实际发送：按场景调底座 MCP 工具
  async send({ scene, peer, text, mode, sticker, emotionResult, dryRun }) {
    const common = { dryRun: dryRun || undefined };
    if (scene === 'dm') {
      if (!this.config.enableDm) return { skipped: true, reason: '私信回复已关闭' };
      const args = {
        peer,
        text: mode === 'sticker' ? '' : text,
        ...(sticker ? { image: sticker.path, sticker_key: sticker.id } : {}),
        ...common,
      };
      const raw = await this.mcp.callText('douyin_dm', args);
      return { tool: 'douyin_dm', raw };
    }
    if (!this.config.enableComment) return { skipped: true, reason: '评论回复已关闭' };
    if (sticker) {
      const args = {
        aweme_id: peer.awemeId || '',
        reply_id: peer.commentId || '',
        text: mode === 'sticker' ? '' : text,
        sticker_key: sticker.id,
        ...common,
      };
      const raw = await this.mcp.callText('douyin_comment_sticker', args);
      return { tool: 'douyin_comment_sticker', raw };
    }
    const args = {
      aweme_id: peer.awemeId || '',
      reply_id: peer.commentId || '',
      text,
      ...common,
    };
    const raw = await this.mcp.callText('douyin_comment_reply', args);
    return { tool: 'douyin_comment_reply', raw };
  }

  // 轮询：从底座拉新私信和@，逐条处理
  async pollOnce({ dryRun = false } = {}) {
    const outcomes = [];
    if (this.config.enableDm) {
      try {
        const raw = await this.mcp.callText('douyin_im_read', { unreadOnly: true });
        const data = JSON.parse(raw);
        for (const m of data.messages || []) {
          outcomes.push(await this.processIncoming({
            scene: 'dm', text: m.text || '', peer: m.peer || m.from || '',
            key: m.id, dryRun,
          }));
        }
      } catch (e) {
        this.logger('poll-dm-error', e.message);
      }
    }
    if (this.config.enableComment) {
      try {
        const raw = await this.mcp.callText('douyin_at_me', {});
        const data = JSON.parse(raw);
        for (const ev of data.events || []) {
          outcomes.push(await this.processIncoming({
            scene: 'comment', text: ev.text || '',
            peer: { awemeId: ev.aweme_id, commentId: ev.comment_id },
            key: ev.id, dryRun,
          }));
        }
      } catch (e) {
        this.logger('poll-comment-error', e.message);
      }
    }
    return outcomes;
  }

  // 暴露给提示词构建（值班轮用）
  static emotionPrompt(text, context) {
    return buildEmotionPrompt(text, context);
  }
}
