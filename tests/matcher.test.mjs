// 语义匹配测试：匹配结果必须情绪一致，且优先意图/关键词命中。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchSticker, scoreSticker } from '../lib/matcher.mjs';
import { analyzeByRules } from '../lib/emotion.mjs';
import { makeTmpStore, seedApproved, writePng } from './helpers.mjs';

test('高兴消息只匹配情绪一致的 happy 桶', () => {
  const { dir, store } = makeTmpStore();
  seedApproved(store, dir);
  const e = analyzeByRules('哈哈太开心了，真好');
  for (let i = 0; i < 20; i += 1) {
    const r = matchSticker(e, store);
    assert.ok(r.sticker);
    assert.equal(['happy', 'shy', 'daily'].includes(r.sticker.emotion), true);
    assert.notEqual(r.sticker.emotion, 'sad');
    assert.notEqual(r.sticker.emotion, 'angry');
  }
});

test('难过消息不会匹配到得意/大笑表情', () => {
  const { dir, store } = makeTmpStore();
  seedApproved(store, dir);
  const e = analyzeByRules('我好难过，好想哭');
  const r = matchSticker(e, store);
  assert.ok(r.sticker);
  assert.equal(['sad', 'shy', 'daily'].includes(r.sticker.emotion), true);
  assert.notEqual(r.sticker.tags.includes('grin'), true);
});

test('无情绪一致候选时返回 null（调用方降级纯文字）', () => {
  const { dir, store } = makeTmpStore();
  // 只放一张 angry 表情
  const img = writePng(dir, `only_angry_${Math.random().toString(36).slice(2)}.png`);
  store.ingestImage({
    imagePath: img, source: 'builtin', emotion: 'angry',
    tags: ['fury'], autoApprove: true,
  });
  const e = analyzeByRules('哈哈好开心');
  const r = matchSticker(e, store);
  assert.equal(r.sticker, null);
});

test('打分：意图标签命中获得加权', () => {
  const e = { primary: 'daily', intent: 'thanks', matchedKeywords: [] };
  const thanks = { emotion: 'daily', tags: ['thanks', 'flower'], keywords: [], useCount: 0 };
  const plain = { emotion: 'daily', tags: ['listen'], keywords: [], useCount: 0 };
  assert.ok(scoreSticker(e, thanks) > scoreSticker(e, plain));
});
