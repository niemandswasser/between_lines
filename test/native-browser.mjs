import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const targets = await fetch('http://127.0.0.1:9250/json/list').then(response => response.json());
const socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let sequence = 0;
const pending = new Map(), errors = [];
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) { const request = pending.get(message.id); pending.delete(message.id); if (request) message.error ? request.reject(message.error) : request.resolve(message.result); }
  else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
});
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 12000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function run(expression) {
  const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, replMode: true });
  if (response.exceptionDetails) throw Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result.value;
}
async function until(expression) {
  const end = Date.now() + 8000;
  while (Date.now() < end) { if (await run(expression)) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw Error('Timed out: ' + expression);
}
async function click(selector) { await run(`document.querySelector(${JSON.stringify(selector)}).click()`); }
async function screenshot(name) { const image = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await fs.writeFile(new URL('../' + name, import.meta.url), Buffer.from(image.data, 'base64')); }
async function reset() {
  await call('Page.navigate', { url: 'http://127.0.0.1:4198/' }); await until('window.fixture?.ready');
}
try {
  await call('Runtime.enable'); await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: 'http://127.0.0.1:4198/?seed=1' }); await until('window.fixture?.ready');
  assert.equal(await run('fixture.calls'), 0, 'migration never requests a model');
  assert.equal(await run('app.nativeExtension'), true);
  assert.equal(await run('app.ledger.articles.length'), 3);
  assert.equal(await run('app.settings().notes[app.ledger.articles[0].id]'), 'Saved private note');
  assert.equal(await run('app.env.connection.settings().profileId'), 'codex', 'legacy connection profile inherited by ID');
  assert.equal(await run('ctx.extensionSettings.ExtBlocks.extblocks_is_enabled'), false);
  assert.equal(await run('legacyBlocks.every(block=>block.disabled)'), true);
  assert.equal(await run('ctx.extensionSettings.connectionManager.selectedProfile'), 'main');
  await run('app.open();app.openSettings()');
  assert.equal(await run('document.querySelector("#bl-settings [data-bl-profile]").value'), 'codex');
  await screenshot('qa-native-settings.png');
  await run('document.querySelector("#bl-settings [data-bl-profile]").value="main";document.querySelector("#bl-settings form").requestSubmit()');
  assert.equal(await run('app.env.connection.settings().profileId'), 'main');
  await run('await app.collect(2,true)');
  assert.equal(await run('fixture.requestProfile'), 'main');
  assert.equal(await run('ctx.extensionSettings.connectionManager.selectedProfile'), 'main');
  await run('app.openConnectionDialog();document.querySelector("#bl-connection [data-bl-profile]").value="codex";document.querySelector("#bl-connection form").requestSubmit();await app.collect(2,true)');
  assert.equal(await run('fixture.requestProfile'), 'codex');
  assert.equal(await run('ctx.extensionSettings.connectionManager.selectedProfile'), 'main');
  // No chats are required to configure a profile; no active-chat data is changed.
  await run('window.originalChat=ctx.chat;ctx.chat=[];ctx.chatId="";app.openSettings()');
  assert.equal(await run('document.querySelector("#bl-connection").open'), true);
  await run('document.querySelector("#bl-connection").close();ctx.chat=originalChat;ctx.chatId="between-lines-fixture";app.refresh()');
  // Streaming delivers rendered/ended events; only the completed assistant message is collected.
  await reset();
  await run('await emit("GENERATION_STARTED");await emit("CHARACTER_MESSAGE_RENDERED",2,"normal")');
  assert.equal(await run('fixture.calls'), 0);
  await run('await emit("GENERATION_ENDED")'); await until('fixture.calls===1 && !app.working');
  await run('await emit("CHARACTER_MESSAGE_RENDERED",2,"normal");await emit("GENERATION_ENDED")');
  assert.equal(await run('fixture.calls'), 1, 'duplicate events do not collect twice');
  await run('ctx.chat.push({mes:"Another completed reply"});await emit("GENERATION_STARTED");await emit("CHARACTER_MESSAGE_RENDERED",3,"normal");await emit("GENERATION_ENDED")');
  await until('fixture.calls===2 && !app.working');
  await run('ctx.chat.push({mes:"Stopped partial reply"});await emit("GENERATION_STARTED");await emit("CHARACTER_MESSAGE_RENDERED",4,"normal");await emit("GENERATION_STOPPED");await emit("GENERATION_ENDED")');
  assert.equal(await run('fixture.calls'), 2);
  await run('ctx.chat.push({mes:"Greeting"});await emit("CHARACTER_MESSAGE_RENDERED",5,"first_message")');
  assert.equal(await run('fixture.calls'), 2);
  // Switching a profile aborts and rejects an in-flight result, preserving the saved codex.
  const snapshot = await run('JSON.stringify(ctx.chat[3].extra.between_lines_v1)');
  await run('fixture.wait=true;fixture.finish=null;window.collection=app.collect(3,true);void 0'); await until('!!fixture.finish');
  await run('app.saveConnectionSettings({...app.env.connection.settings(),profileId:"main"});fixture.wait=false;fixture.finish();await collection');
  assert.equal(await run('fixture.requestSignal.aborted'), true);
  assert.equal(await run('JSON.stringify(ctx.chat[3].extra.between_lines_v1)'), snapshot);
  // Missing profiles fail explicitly, without falling back to the main chat connection.
  await run('app.saveConnectionSettings({...app.env.connection.settings(),profileId:"deleted"});window.beforeCalls=fixture.calls;await app.collect(3,true)');
  assert.equal(await run('fixture.calls'), await run('beforeCalls'));
  assert.equal(await run('ctx.extensionSettings.connectionManager.selectedProfile'), 'main');
  await run('app.saveConnectionSettings({...app.env.connection.settings(),profileId:"codex"});app.openConnectionDialog()');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await run('document.querySelector("#bl-connection").scrollWidth<=document.querySelector("#bl-connection").clientWidth'), true);
  await screenshot('qa-native-connection-mobile.png');
  await call('Emulation.setDeviceMetricsOverride', { width: 320, height: 740, deviceScaleFactor: 1, mobile: true });
  assert.equal(await run('document.querySelector("#bl-connection").scrollWidth<=document.querySelector("#bl-connection").clientWidth'), true);
  assert.deepEqual(errors, []);
  console.log('PASS: native migration preserves articles/notes, inherited profile, works with ExtBlocks OFF, independent profile selection, empty-chat setup, streaming collection once, stopped generations ignored, stale profile abort, missing-profile error, mobile 390/320. Mocked model responses only.');
} finally { socket.close(); }
