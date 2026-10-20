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
  throw Error('Timed out: ' + expression + JSON.stringify(errors));
}
async function click(selector) { await run(`document.querySelector(${JSON.stringify(selector)}).click()`); }
async function screenshot(name) { const image = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await fs.writeFile(new URL('../' + name, import.meta.url), Buffer.from(image.data, 'base64')); }
async function reset() {
  await call('Page.navigate', { url: 'http://127.0.0.1:4198/' }); await until('window.fixture?.ready');
}
try {
  await call('Runtime.enable'); await call('Page.enable');
  await reset();
  await run('app.open();app.openSettings()');
  assert.equal(await run('document.querySelector("[name=connectionInputMaxTokens]").value'), '12000');
  assert.equal(await run('document.querySelector("[name=connectionLoreMaxTokens]").value'), '2000');
  await run('document.querySelector("[name=connectionInputMaxTokens]").value="16000";document.querySelector("[name=connectionLoreMaxTokens]").value="1200";document.querySelector("#bl-settings form").requestSubmit()');
  assert.equal(await run('app.env.connection.settings().inputMaxTokens'), 16000);
  assert.equal(await run('app.env.connection.settings().loreMaxTokens'), 1200);
  assert.equal(await run('fixture.calls'), 0);
  await run('await app.collect(2,true);window.originalRecord=JSON.stringify(ctx.chat[2].extra.between_lines_v1)');
  await run('app.openConnectionDialog()');
  assert.equal(await run('!!document.querySelector("[data-bl-context-usage]")'), true);
  assert.equal(await run('document.querySelector("#bl-connection [name=connectionInputMaxTokens]").value'), '16000');
  await run('document.querySelector("#bl-connection [name=connectionInputMaxTokens]").value="12000";document.querySelector("#bl-connection [name=connectionLoreMaxTokens]").value="0";document.querySelector("#bl-connection form").requestSubmit()');
  await run('ctx.chat[0].mes="Earlier message. ".repeat(4000);ctx.chat[2].mes+="\\nLong scene. ".repeat(6000);await app.collect(2,true)');
  assert.equal(await run('app.env.connection.lastContext.inputTokens <= 12000'), true);
  assert.equal(await run('fixture.lastInput.messages.at(-1).id'), 2);
  assert.equal(await run('fixture.lastInput.contextSummary.truncatedMessageIds.includes(2)'), true);
  assert.equal(await run('app.ledger.articles.length'), 3);
  assert.equal(await run('ctx.chat[2].mes.length > 60000'), true);
  assert.equal(await run('ctx.extensionSettings.connectionManager.selectedProfile'), 'main');
  for (const width of [390, 320]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
    await run('app.openConnectionDialog()');
    assert.equal(await run('document.querySelector("#bl-connection").scrollWidth <= document.querySelector("#bl-connection").clientWidth + 2'), true);
    assert.equal(await run('document.querySelector("[name=connectionInputMaxTokens]").getBoundingClientRect().right <= innerWidth'), true);
    await run('document.querySelector("#bl-connection").close()');
  }
  assert.deepEqual(errors, []);
  console.log('PASS: both settings forms persist independent context/lore budgets; local usage display; oversized scenes bounded without trimming chat; profile unchanged; mobile 390/320. Mocked responses only.');
} finally { socket.close(); }
