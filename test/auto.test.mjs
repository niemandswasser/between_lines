import test from 'node:test';
import assert from 'node:assert/strict';
import { preferences } from '../src/core.mjs';
import { planAutoCollection, markAutoCollected } from '../src/auto.mjs';
const answer = text => ({ mes: text });

test('interval defaults to one and is limited to 1–100 integer assistant replies', () => {
  assert.equal(preferences().autoEvery, 1);
  assert.equal(preferences({ autoEvery: 0 }).autoEvery, 1);
  assert.equal(preferences({ autoEvery: 1000 }).autoEvery, 100);
  assert.equal(preferences({ autoEvery: 2.6 }).autoEvery, 3);
});

test('three completed replies trigger once; player turns and duplicate events do not advance the count', () => {
  const chat = [answer('First')];
  let result = planAutoCollection(chat, 0, undefined, 3);
  assert.equal(result.due, false);
  chat.push({ mes: 'Player', is_user: true });
  assert.equal(planAutoCollection(chat, 1, result.state, 3).counted, false);
  chat.push(answer('Second'));
  result = planAutoCollection(chat, 2, result.state, 3);
  assert.equal(result.due, false);
  assert.equal(planAutoCollection(chat, 2, result.state, 3).counted, false);
  chat.push(answer('Third'));
  result = planAutoCollection(chat, 3, JSON.parse(JSON.stringify(result.state)), 3);
  assert.equal(result.due, true);
  const reset = markAutoCollected(chat, 3, result.state, 3);
  chat.push(answer('Fourth'));
  result = planAutoCollection(chat, 4, reset, 3);
  assert.equal(result.due, false); assert.equal(result.state.frames.at(-1).count, 1);
});

test('a manual collection resets the interval; a failed collection remains due at the next reply', () => {
  const chat = [answer('One')];
  const first = planAutoCollection(chat, 0, undefined, 2);
  const manual = markAutoCollected(chat, 0, first.state, 2);
  chat.push(answer('Two'));
  let next = planAutoCollection(chat, 1, manual, 2); assert.equal(next.due, false);
  chat.push(answer('Three'));
  next = planAutoCollection(chat, 2, next.state, 2); assert.equal(next.due, true);
  assert.equal(planAutoCollection(chat, 2, next.state, 2).due, false, 'no immediate retry on duplicate event');
  chat.push(answer('Four'));
  assert.equal(planAutoCollection(chat, 3, next.state, 2).due, true);
});

test('swiping replaces one reply instead of counting an extra; changed ancestors invalidate later counter frames', () => {
  const chat = [answer('One'), { ...answer('Variant A'), swipe_id: 0 }];
  let state = planAutoCollection(chat, 0, undefined, 3).state;
  state = planAutoCollection(chat, 1, state, 3).state;
  chat[1].swipe_id = 1; chat[1].mes = 'Variant B';
  const swipe = planAutoCollection(chat, 1, state, 3);
  assert.equal(swipe.due, false); assert.equal(swipe.state.frames.at(-1).count, 2);
  chat[0].mes = 'Edited first reply';
  const edited = planAutoCollection(chat, 1, swipe.state, 3);
  assert.equal(edited.state.frames.at(-1).count, 1);
});

test('different chat state and a changed interval start independent counters', () => {
  const chat = [answer('One'), answer('Two')];
  let state = planAutoCollection(chat, 0, undefined, 3).state;
  state = planAutoCollection(chat, 1, state, 3).state;
  assert.equal(planAutoCollection([answer('Other chat')], 0, undefined, 3).state.frames.at(-1).count, 1);
  chat.push(answer('Three'));
  assert.equal(planAutoCollection(chat, 2, state, 5).state.frames.at(-1).count, 1);
});
