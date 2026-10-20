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
  await reset(); await run('await __betweenLinesApp.collect(2);__betweenLinesApp.open();await __betweenLinesApp.generateWriting(__betweenLinesApp.selected,{form:"letter"});fixture.writingResponse={...writingSample,articleId:__betweenLinesApp.selected,form:"diary",title:"Second page",body:writingSample.body+" Second ending."};await __betweenLinesApp.generateWriting(__betweenLinesApp.selected,{form:"diary"})');
  const facts = await run('JSON.stringify(__betweenLinesApp.ledger.articles[0].facts)');
  const calls = await run('fixture.calls');
  const saved = await run('JSON.stringify(ctx.chat[2].extra.between_lines_v1)');
  await click('[data-action=edit-page]');
  assert.equal(await run('document.querySelector("#bl-page-editor").open'), true);
  await run('document.querySelector("#bl-page-editor [name=title]").value="Discarded"');
  await click('#bl-page-editor footer [data-cancel]');
  assert.equal(await run('JSON.stringify(ctx.chat[2].extra.between_lines_v1)'), saved);
  await click('[data-action=edit-page]');
  await screenshot('qa-page-editor.png');
  await run('window.editedId=document.querySelector(".bl-world-page").dataset.pageId;document.querySelector("#bl-page-editor [name=title]").value="Записка у ворот";document.querySelector("#bl-page-editor [name=byline]").value="Без подписи";document.querySelector("#bl-page-editor [name=form]").value="letter";document.querySelector("#bl-page-editor [name=body]").value="Короткая записка. <img src=x onerror=alert(1)>";document.querySelector("#bl-page-editor form").requestSubmit()');
  await until('!__betweenLinesApp.working && !document.querySelector("#bl-page-editor").open');
  assert.equal(await run('__betweenLinesApp.ledger.articles[0].pages.find(p=>p.id===editedId).title'), 'Записка у ворот');
  assert.equal(await run('__betweenLinesApp.ledger.articles[0].pages.find(p=>p.id===editedId).manual'), true);
  assert.equal(await run('document.querySelectorAll(".bl-page-prose img").length'), 0);
  assert.equal(await run('JSON.stringify(__betweenLinesApp.ledger.articles[0].facts)'), facts);
  assert.equal(await run('fixture.calls'), calls, 'editing never calls a model');
  // Older pages remain editable and expanded after a save.
  await run('document.querySelector(".bl-older-pages").open=true');
  await click('.bl-older-pages [data-action=edit-page]');
  const beforeFailure = await run('JSON.stringify(ctx.chat[2].extra.between_lines_v1)');
  await run('fixture.saveFail=true;document.querySelector("#bl-page-editor [name=title]").value="Retry title";document.querySelector("#bl-page-editor form").requestSubmit()');
  await until('!__betweenLinesApp.working');
  assert.equal(await run('JSON.stringify(ctx.chat[2].extra.between_lines_v1)'), beforeFailure);
  assert.equal(await run('document.querySelector("#bl-page-editor").open'), true);
  await run('fixture.saveFail=false;document.querySelector("#bl-page-editor form").requestSubmit()');
  await until('!__betweenLinesApp.working && !document.querySelector("#bl-page-editor").open');
  assert.equal(await run('document.querySelector(".bl-older-pages").open'), true);
  // Stale dialogs cannot save after a swipe or concurrent page change.
  await click('[data-action=edit-page]');
  const beforeStale = await run('JSON.stringify(ctx.chat[2].extra.between_lines_v1)');
  await run('ctx.chat[2].swipe_id=1;ctx.chat[2].mes=ctx.chat[2].swipes[1];document.querySelector("#bl-page-editor form").requestSubmit()');
  await until('!__betweenLinesApp.working');
  assert.equal(await run('JSON.stringify(ctx.chat[2].extra.between_lines_v1)'), beforeStale);
  await run('document.querySelector("#bl-page-editor").close();ctx.chat[2].swipe_id=0;ctx.chat[2].mes=ctx.chat[2].swipes[0];__betweenLinesApp.refresh()');
  await run('window.stale=__betweenLinesApp.pageSession(__betweenLinesApp.selected,editedId);window.values={title:"Stale",form:"letter",byline:"",body:"New body"};await __betweenLinesApp.changePage(stale,values)');
  assert.equal(await run('await __betweenLinesApp.changePage(stale,{...values,title:"Overwrite"})'), false);
  // Mobile editor does not overflow.
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await click('[data-action=edit-page]');
  assert.equal(await run('document.querySelector("#bl-page-editor").scrollWidth<=document.querySelector("#bl-page-editor").clientWidth'), true);
  await screenshot('qa-page-editor-mobile.png');
  await call('Emulation.setDeviceMetricsOverride', { width: 320, height: 740, deviceScaleFactor: 1, mobile: true });
  assert.equal(await run('document.querySelector("#bl-page-editor").scrollWidth<=document.querySelector("#bl-page-editor").clientWidth'), true);
  await click('#bl-page-editor footer [data-cancel]');
  // Delete requires confirmation and preserves the article and other pages.
  const beforeDelete = await run('JSON.stringify(ctx.chat[2].extra.between_lines_v1)');
  await click('[data-action=delete-page]'); await click('#bl-page-delete footer [data-cancel]');
  assert.equal(await run('JSON.stringify(ctx.chat[2].extra.between_lines_v1)'), beforeDelete);
  await click('[data-action=delete-page]'); await click('#bl-page-delete [type=submit]');
  await until('!__betweenLinesApp.working && !document.querySelector("#bl-page-delete").open');
  assert.equal(await run('__betweenLinesApp.ledger.articles[0].pages.length'), 1);
  assert.equal(await run('JSON.stringify(__betweenLinesApp.ledger.articles[0].facts)'), facts);
  await click('[data-action=delete-page]'); await click('#bl-page-delete [type=submit]');
  await until('!__betweenLinesApp.working && !document.querySelector("#bl-page-delete").open');
  assert.equal(await run('__betweenLinesApp.ledger.articles[0].pages.length'), 0);
  assert.equal(await run('fixture.calls'), calls);
  await run('await __betweenLinesApp.collect(2,true)');
  assert.equal(await run('__betweenLinesApp.ledger.articles[0].pages.length'), 0, 'deleted pages never reappear on collection');
  assert.deepEqual(errors, []);
  console.log('PASS: edit/cancel, older pages, literal HTML, no model calls, save rollback/retry, stale swipe and page guards, mobile 390/320, confirmed deletion, facts and siblings retained, collection after deletion.');
} finally { socket.close(); }
