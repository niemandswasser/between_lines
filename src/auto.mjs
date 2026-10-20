import { branchHashes, preferences } from './core.mjs';

export const AUTO_STATE = 'between_lines_auto_v1';

function autoState(raw, every) {
  const interval = preferences({ autoEvery: every }).autoEvery;
  const frames = raw?.every === interval && Array.isArray(raw.frames) ? raw.frames.filter(frame => Number.isInteger(frame.id) && frame.id >= 0 && typeof frame.branch === 'string' && Number.isInteger(frame.count) && frame.count >= 0 && frame.count <= interval).slice(-256) : [];
  return { every: interval, frames: structuredClone(frames) };
}
function withAutoFrame(state, frame) {
  return { every: state.every, frames: [...state.frames.filter(item => item.id !== frame.id || item.branch !== frame.branch), frame].slice(-256) };
}

export function planAutoCollection(chat, target, rawState, every) {
  const state = autoState(rawState, every), message = chat[target];
  if (!message || message.is_user || message.is_system || ['', '...', '…'].includes(String(message.mes || '').trim()) || String(message.mes).includes('Proxy error')) return { state, due: false, counted: false };
  const hashes = branchHashes(chat);
  const valid = state.frames.filter(frame => frame.id < chat.length && frame.branch === hashes[frame.id]);
  if (valid.some(frame => frame.id >= target)) return { state, due: false, counted: false };
  const previous = valid.filter(frame => frame.id < target).sort((a, b) => b.id - a.id)[0];
  const count = Math.min((previous?.count || 0) + 1, state.every);
  return { state: withAutoFrame(state, { id: target, branch: hashes[target], count }), due: count >= state.every, counted: true };
}

export function markAutoCollected(chat, target, rawState, every) {
  const state = autoState(rawState, every), hashes = branchHashes(chat);
  if (!hashes[target]) return state;
  return withAutoFrame(state, { id: target, branch: hashes[target], count: 0 });
}
