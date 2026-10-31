// 情绪一致性硬闸对抗用例：用户最强调的约束——绝不能高兴发悲伤、安慰发愤怒。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEmotion } from '../lib/emotion-gate.mjs';
import { analyzeByRules } from '../lib/emotion.mjs';

const mk = (emotion, tags = [], status = 'approved') => ({
  id: `x_${emotion}`, emotion, tags, status,
});

test('高兴消息：允许 happy，禁止 sad/angry', () => {
  const e = analyzeByRules('哈哈今天太开心了，太棒了');
  assert.equal(e.primary, 'happy');
  assert.equal(checkEmotion(e, mk('happy', ['grin'])).ok, true);
  assert.equal(checkEmotion(e, mk('sad', ['cry'])).ok, false);
  assert.equal(checkEmotion(e, mk('angry', ['fury'])).ok, false);
});

test('难过/安慰场景：允许温暖抱抱，禁止愤怒与得意大笑', () => {
  const e = analyzeByRules('我好难过，工作压力好大，好想哭');
  assert.equal(e.primary, 'sad');
  assert.equal(checkEmotion(e, mk('shy', ['hug', 'soft'])).ok, true);
  assert.equal(checkEmotion(e, mk('sad', ['tissue'])).ok, true);
  const angry = checkEmotion(e, mk('angry', ['fury']));
  assert.equal(angry.ok, false);
  const smug = checkEmotion(e, mk('happy', ['smug', 'grin']));
  assert.equal(smug.ok, false);
});

test('愤怒消息：禁止挑衅/得意/开心，允许冷静 daily', () => {
  const e = analyzeByRules('气死我了，这东西真的离谱，我要投诉');
  assert.equal(e.primary, 'angry');
  assert.equal(checkEmotion(e, mk('daily', ['listen'])).ok, true);
  assert.equal(checkEmotion(e, mk('happy', ['laugh'])).ok, false);
  assert.equal(checkEmotion(e, mk('angry', ['rage'])).ok, false);
});

test('疑惑消息：允许 confused，禁止愤怒', () => {
  const e = analyzeByRules('这是什么意思？我没看懂');
  assert.equal(e.primary, 'confused');
  assert.equal(checkEmotion(e, mk('confused', ['think'])).ok, true);
  assert.equal(checkEmotion(e, mk('angry', ['fury'])).ok, false);
});

test('fail-closed：未审核/缺情绪字段一律拦截', () => {
  const e = analyzeByRules('日常闲聊');
  assert.equal(checkEmotion(e, mk('daily', [], 'pending')).ok, false);
  assert.equal(checkEmotion(e, { id: 'no', tags: [] }).ok, false);
  assert.equal(checkEmotion(e, null).ok, false);
});

test('安慰意图标签级拦截', () => {
  const e = { primary: 'sad', intent: 'comfort' };
  assert.equal(checkEmotion(e, mk('shy', ['hug'])).ok, true);
  assert.equal(checkEmotion(e, mk('shy', ['mock'])).ok, false);
});
