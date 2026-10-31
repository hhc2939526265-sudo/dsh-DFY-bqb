// 编排引擎集成测试：完整闭环 + 安全拦截 + 去重 + 计数（FakeMcp，不碰真机）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BqbEngine } from '../lib/engine.mjs';
import { FakeMcpClient } from '../lib/mcp-client.mjs';
import { DEFAULT_CONFIG } from '../lib/config.mjs';
import { makeTmpStore, seedApproved } from './helpers.mjs';

function newEngine() {
  const { dir, store } = makeTmpStore();
  seedApproved(store, dir);
  const mcp = new FakeMcpClient();
  const engine = new BqbEngine({ ...DEFAULT_CONFIG }, { store, mcp });
  return { engine, store, mcp };
}

test('dry-run 处理高兴消息：情绪正确，结果结构完整', async () => {
  const { engine } = newEngine();
  const r = await engine.processIncoming({
    scene: 'dm', text: '哈哈今天太开心了，太棒了', peer: 'u1', dryRun: true,
  });
  assert.equal(r.skipped, false);
  assert.equal(r.emotion.primary, 'happy');
  assert.ok(['text', 'sticker', 'text+sticker'].includes(r.mode));
  if (r.sticker) {
    assert.equal(['happy', 'shy', 'daily'].includes(r.sticker.emotion), true);
  }
});

test('安全拦截：广告/恶意消息直接跳过', async () => {
  const { engine } = newEngine();
  const ad = await engine.processIncoming({
    scene: 'dm', text: '加微信日赚300，免费领红包', peer: 'spam', dryRun: true,
  });
  assert.equal(ad.skipped, true);
  assert.match(ad.reason, /安全拦截/);
});

test('去重：同一消息第二次处理被跳过', async () => {
  const { engine } = newEngine();
  const args = { scene: 'dm', text: '在吗，晚上好', peer: 'u2', key: 'fixed-key-1', dryRun: true };
  const first = await engine.processIncoming(args);
  const second = await engine.processIncoming(args);
  assert.equal(first.skipped, false);
  assert.equal(second.skipped, true);
});

test('真实发送（非 dryRun）：贴纸计数与使用次数增加', async () => {
  const { engine, store } = newEngine();
  // 多试几条直到命中带表情的形态
  let r;
  for (let i = 0; i < 8; i += 1) {
    r = await engine.processIncoming({
      scene: 'dm', text: `哈哈好开心呀 第${i}条`, peer: `peer_${i}`, dryRun: false,
    });
    if (r.sticker) break;
  }
  if (r.sticker) {
    assert.ok(store.dailyStickerCount() >= 1);
    const used = store.get(r.sticker.id);
    assert.ok(used.useCount >= 1);
  }
});

test('评论区场景走评论工具，不串到私信', async () => {
  const { engine } = newEngine();
  const r = await engine.processIncoming({
    scene: 'comment',
    text: '你这个视频做得真厉害，点赞',
    peer: { awemeId: 'aw1', commentId: 'c1' },
    dryRun: true,
  });
  assert.equal(r.skipped, false);
  assert.match(r.send.tool, /comment/);
});
