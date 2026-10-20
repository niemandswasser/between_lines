import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexConnection, EXTENSION_KEY, connectionSettings } from '../src/connection.mjs';

function fixture(extra = {}) {
  const state = { characterId: 0, maxContext: 16000, extensionSettings: { [EXTENSION_KEY]: { profileId: 'codex', enabled: true }, connectionManager: { selectedProfile: 'main' } }, ...extra };
  const calls = [], profiles = [{ id: 'codex', name: 'Codex', api: 'custom', model: 'model-a' }];
  const service = { getSupportedProfiles: () => profiles, constructPrompt: (messages, id) => ({ messages, id }), sendRequest: async (...args) => { calls.push(args); return { content: '{"articles":[],"terms":[]}', reasoning: 'Private reasoning' }; } };
  return { state, calls, profiles, service, adapter: new CodexConnection(() => state, service, { collect: 'English instructions' }) };
}
const input = { profile: { outputLanguage: 'Russian', allowLorebook: false }, messages: [{ id: 2, text: 'The watch.' }] };

test('requests use explicit profile, prompt formatter and server secrets while leaving main connection unchanged', async () => {
  const f = fixture();
  assert.equal(await f.adapter.request('collect', input), '{"articles":[],"terms":[]}');
  const [id, formatted, tokens, options, overrides] = f.calls[0];
  assert.equal(id, 'codex'); assert.equal(formatted.id, 'codex'); assert.equal(tokens, 6000);
  assert.equal(options.stream, false); assert.equal(options.includePreset, true); assert.equal(options.includeInstruct, true);
  assert.ok(options.signal instanceof AbortSignal); assert.equal(overrides.temperature, 0.35);
  assert.equal(f.state.extensionSettings.connectionManager.selectedProfile, 'main');
  assert.equal(formatted.messages[1].content, JSON.stringify(input));
});

test('missing or deleted profiles cause a clear error without fallback or requests', async () => {
  const f = fixture(); f.state.extensionSettings[EXTENSION_KEY].profileId = '';
  await assert.rejects(f.adapter.request('collect', input), /Выберите профиль/);
  f.state.extensionSettings[EXTENSION_KEY].profileId = 'deleted';
  await assert.rejects(f.adapter.request('collect', input), /удалён/); assert.equal(f.calls.length, 0);
});

test('lorebook scanning is a dry run and covers depth, examples and outlet material', async () => {
  let scan;
  const f = fixture({ getWorldInfoPrompt: async (...args) => { scan = args; return { worldInfoString: 'Base', worldInfoExamples: [{ content: 'Example' }], worldInfoDepth: [{ entries: ['Depth'] }], outletEntries: { x: ['Outlet'] } }; } });
  await f.adapter.request('collect', { ...input, profile: { ...input.profile, allowLorebook: true } });
  assert.equal(scan[2], true); assert.equal(scan[1], 16000);
  assert.match(f.calls[0][1].messages[2].content, /Base\n\nExample\n\nDepth\n\nOutlet/);
});

test('profile changes during request reject stale output and never switch the chat profile', async () => {
  const f = fixture();
  f.service.sendRequest = async () => { f.state.extensionSettings[EXTENSION_KEY].profileId = 'other'; return { content: 'stale' }; };
  await assert.rejects(f.adapter.request('collect', input), /не сохранён/);
  assert.equal(f.state.extensionSettings.connectionManager.selectedProfile, 'main');
});

test('abort and empty replies release the request lock', async () => {
  const f = fixture();
  f.service.sendRequest = async () => { f.adapter.cancel(); return { content: 'late' }; };
  await assert.rejects(f.adapter.request('collect', input), /отменён/); assert.equal(f.adapter.active, null);
  f.service.sendRequest = async () => ({ content: '' });
  await assert.rejects(f.adapter.request('collect', input), /пустой/); assert.equal(f.adapter.active, null);
});

test('connection settings clamp response limits and preserve an explicit disabled choice', () => {
  assert.equal(connectionSettings({ maxTokens: 999999, temperature: -10, enabled: false }).maxTokens, 32000);
  assert.equal(connectionSettings({ temperature: -10 }).temperature, 0);
  assert.equal(connectionSettings({ enabled: false }).enabled, false);
});
