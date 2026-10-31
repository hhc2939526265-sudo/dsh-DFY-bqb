// 形态决策测试：注入固定 rng，验证概率分布、风控降级与愤怒场景规则。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideMode } from '../lib/decision.mjs';
import { DEFAULT_CONFIG } from '../lib/config.mjs';

const cfg = { ...DEFAULT_CONFIG };
const zeroCounts = { daily: 0, perPeer: 0 };
const fixedRng = (v) => () => v;

test('达到每日/同人上限强制纯文字', () => {
  const e = { primary: 'happy', intent: 'neutral' };
  assert.equal(decideMode(e, 'dm', cfg, { daily: 5, perPeer: 0 }, fixedRng(0)).mode, 'text');
  assert.equal(decideMode(e, 'dm', cfg, { daily: 0, perPeer: 2 }, fixedRng(0)).mode, 'text');
});

test('愤怒场景禁止纯表情，只允许 text 或 text+sticker', () => {
  const e = { primary: 'angry', intent: 'complain' };
  const modes = new Set();
  for (let i = 0; i <= 10; i += 1) {
    modes.add(decideMode(e, 'dm', cfg, zeroCounts, fixedRng(i / 10)).mode);
  }
  assert.equal(modes.has('sticker'), false);
  assert.equal(modes.has('text'), true);
});

test('私信概率区间：纯表情/文字+表情/纯文字', () => {
  const e = { primary: 'daily', intent: 'neutral' };
  // rng 0.05 落在纯表情区间（pure=0.15）
  assert.equal(decideMode(e, 'dm', cfg, zeroCounts, fixedRng(0.05)).mode, 'sticker');
  // rng 0.3 落在文字+表情区间
  assert.equal(decideMode(e, 'dm', cfg, zeroCounts, fixedRng(0.3)).mode, 'text+sticker');
  // rng 0.9 纯文字
  assert.equal(decideMode(e, 'dm', cfg, zeroCounts, fixedRng(0.9)).mode, 'text');
});

test('评论区默认不发纯表情（pure=0）', () => {
  const e = { primary: 'happy', intent: 'neutral' };
  const modes = new Set();
  for (let i = 0; i <= 10; i += 1) {
    modes.add(decideMode(e, 'comment', cfg, zeroCounts, fixedRng(i / 10)).mode);
  }
  assert.equal(modes.has('sticker'), false);
});
