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
async function reply() {
  await run('ctx.chat.push({mes:"Player turn",is_user:true},{mes:"Reply "+ctx.chat.length});await emit("GENERATION_STARTED");await emit("CHARACTER_MESSAGE_RENDERED",ctx.chat.length-1,"normal");await emit("GENERATION_ENDED")');
  await until('!app.working');
}
try {
  await call('Runtime.enable'); await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
  await reset(); await run('app.open();app.openSettings()');
  assert.equal(await run('document.querySelector("[name=autoEvery]").value'), '1');
  await run('document.querySelector("[name=autoEvery]").value="3";document.querySelector("#bl-settings form").requestSubmit()');
  assert.equal(await run('app.settings().autoEvery'), 3);
  await run('await emit("CHARACTER_MESSAGE_RENDERED",2,"normal")');
  assert.equal(await run('fixture.calls'), 0);
  await reply(); assert.equal(await run('fixture.calls'), 0);
  await run('window.chatA=ctx.chat;window.metaA=ctx.chatMetadata;ctx.chat=[{mes:"Greeting"},{mes:"Player",is_user:true},{mes:"Other chat reply"}];ctx.chatMetadata={between_lines_preferences_v1:{autoEvery:3}};ctx.chatId="chat-b";await emit("CHAT_CHANGED");await emit("CHARACTER_MESSAGE_RENDERED",2,"normal")');
  assert.equal(await run('fixture.calls'), 0);
  await run('ctx.chat=chatA;ctx.chatMetadata=metaA;ctx.chatId="between-lines-fixture";await emit("CHAT_CHANGED")');
  await reply(); assert.equal(await run('fixture.calls'), 1, 'third assistant reply, including after switching chats');
  await run('await emit("CHARACTER_MESSAGE_RENDERED",ctx.chat.length-1,"normal");await emit("GENERATION_ENDED")');
  assert.equal(await run('fixture.calls'), 1);
  await reply(); assert.equal(await run('fixture.calls'), 1);
  await run('await app.collect(app.lastAssistant(),true)');
  assert.equal(await run('fixture.calls'), 2, 'manual update bypasses interval');
  await reply(); await reply(); assert.equal(await run('fixture.calls'), 2, 'manual update starts a fresh interval');
  await reply(); assert.equal(await run('fixture.calls'), 3);
  await run('fixture.badJSON=true');
  await reply(); await reply(); await reply(); assert.equal(await run('fixture.calls'), 4);
  await run('fixture.badJSON=false');
  await reply(); assert.equal(await run('fixture.calls'), 5, 'failed collection retried on next reply');
  await run('app.open();app.openSettings();document.querySelector("[name=auto]").checked=false;document.querySelector("[name=auto]").dispatchEvent(new Event("change"))');
  assert.equal(await run('document.querySelector("[name=autoEvery]").disabled'), true);
  await run('document.querySelector("#bl-settings form").requestSubmit()');
  await reply(); assert.equal(await run('fixture.calls'), 5);
  await run('app.openSettings();document.querySelector("[name=auto]").checked=true;document.querySelector("[name=auto]").dispatchEvent(new Event("change"));document.querySelector("[name=autoEvery]").value="2";document.querySelector("#bl-settings form").requestSubmit()');
  await reply(); assert.equal(await run('fixture.calls'), 5);
  await reply(); assert.equal(await run('fixture.calls'), 6);
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await run('app.openSettings();document.querySelector(".bl-auto-every").scrollIntoView({block:"center"})');
  assert.equal(await run('document.querySelector("#bl-settings").scrollWidth<=document.querySelector("#bl-settings").clientWidth'), true);
  await screenshot('qa-auto-interval-mobile.png');
  assert.deepEqual(errors, []);
  console.log('PASS: configurable interval; assistant replies only; separate chat counters; duplicates ignored; manual update resets; failed request retry; disable/enable/reset; mobile settings. No real model calls.');
} finally { socket.close(); }
