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
  await reset(); await run('await __betweenLinesApp.collect(2);__betweenLinesApp.open()');
  const facts = await run('JSON.stringify(__betweenLinesApp.ledger.articles[0].facts)');
  assert.equal(await run('fixture.writingCalls||0'), 0);
  await click('[data-action=write]');
  assert.equal(await run('document.querySelector("#bl-writing-dialog").open'), true);
  assert.equal(await run('fixture.calls'), 1, 'opening the form never calls a model');
  await screenshot('qa-writing-form.png');
  await run('document.querySelector("#bl-writing-dialog select").value="letter";document.querySelector("#bl-writing-dialog textarea").value="Уставший дозорный пишет домой";document.querySelector("#bl-writing-dialog form").requestSubmit()');
  await until('!__betweenLinesApp.working');
  assert.equal(await run('fixture.writingCalls'), 1);
  assert.equal(await run('fixture.lastBlock.name'), 'write');
  assert.equal(await run('/[\u0400-\u04ff]/.test(fixture.lastBlock.prompt)'), false);
  assert.equal(await run('__betweenLinesApp.ledger.articles[0].pages[0].form'), 'letter');
  assert.equal(await run('JSON.stringify(__betweenLinesApp.ledger.articles[0].facts)'), facts);
  assert.equal(await run('document.querySelector(".bl-world-page h3").textContent'), 'Когда стихает пристань');
  assert.ok(await run('document.querySelector(".bl-page-prose").textContent.length > 500'));
  await screenshot('qa-writing-page.png');
  // Collection and duplicate requests preserve earlier pages.
  await run('await __betweenLinesApp.collect(2,true)');
  assert.equal(await run('__betweenLinesApp.ledger.articles[0].pages.length'), 1);
  await run('await __betweenLinesApp.generateWriting(__betweenLinesApp.selected,{form:"letter"})');
  assert.equal(await run('__betweenLinesApp.ledger.articles[0].pages.length'), 1);
  await run('fixture.writingResponse={...writingSample,articleId:__betweenLinesApp.selected,form:"diary",title:"Дежурство у ворот",body:writingSample.body+"\\n\\nВторая запись."};await __betweenLinesApp.generateWriting(__betweenLinesApp.selected,{form:"diary"});fixture.writingResponse=null');
  assert.equal(await run('__betweenLinesApp.ledger.articles[0].pages.length'), 2);
  assert.equal(await run('document.querySelectorAll(".bl-world-page").length'), 2);
  assert.equal(await run('document.querySelector(".bl-older-pages").open'), false);
  const saved = await run('JSON.stringify(ctx.chat[2].extra.between_lines_v1)');
  await run('fixture.badWriting=true;await __betweenLinesApp.generateWriting(__betweenLinesApp.selected,{form:"letter"});fixture.badWriting=false');
  assert.equal(await run('JSON.stringify(ctx.chat[2].extra.between_lines_v1)'), saved);
  await run('fixture.writingResponse={...writingSample,articleId:"other",form:"letter"};await __betweenLinesApp.generateWriting(__betweenLinesApp.selected,{form:"letter"});fixture.writingResponse=null');
  assert.equal(await run('JSON.stringify(ctx.chat[2].extra.between_lines_v1)'), saved);
  await run('fixture.writingResponse={...writingSample,articleId:__betweenLinesApp.selected,form:"letter",body:writingSample.body+"Failure test."};fixture.saveFail=true;await __betweenLinesApp.generateWriting(__betweenLinesApp.selected,{form:"letter"});fixture.saveFail=false;fixture.writingResponse=null');
  assert.equal(await run('JSON.stringify(ctx.chat[2].extra.between_lines_v1)'), saved);
  // A language change in flight discards the old page.
  await run('fixture.wait=true;fixture.finish=null;window.writingRequest=__betweenLinesApp.generateWriting(__betweenLinesApp.selected,{form:"letter"});void 0'); await until('!!fixture.finish');
  await run('window.prefs=__betweenLinesApp.settings();prefs.language="en";prefs.notes[__betweenLinesApp.selected]="Private journal";__betweenLinesApp.saveSettings(prefs);fixture.wait=false;fixture.finish();await writingRequest');
  assert.equal(await run('JSON.stringify(ctx.chat[2].extra.between_lines_v1)'), saved);
  await run('fixture.writingResponse={...writingSample,articleId:__betweenLinesApp.selected,form:"overheard",title:"Harbor Voices",body:writingSample.body+"\\n\\nA different ending."};await __betweenLinesApp.generateWriting(__betweenLinesApp.selected,{form:"overheard"});fixture.writingResponse=null');
  assert.equal(await run('fixture.lastWritingInput.profile.outputLanguage'), 'English');
  assert.equal(await run('JSON.stringify(fixture.lastWritingInput).includes("Private journal")'), false);
  assert.equal(await run('__betweenLinesApp.ledger.articles[0].pages.at(-1).language'), 'English');
  const last = await run('JSON.stringify(ctx.chat[2].extra.between_lines_v1)');
  await run('fixture.wait=true;fixture.finish=null;window.writingRequest=__betweenLinesApp.generateWriting(__betweenLinesApp.selected,{form:"letter"});void 0'); await until('!!fixture.finish');
  await run('ctx.chat[2].swipe_id=1;ctx.chat[2].mes=ctx.chat[2].swipes[1];fixture.wait=false;fixture.finish();await writingRequest');
  assert.equal(await run('JSON.stringify(ctx.chat[2].extra.between_lines_v1)'), last);
  assert.equal(await run('__betweenLinesApp.ledger.articles.length'), 0);
  await run('ctx.chat[2].swipe_id=0;ctx.chat[2].mes=ctx.chat[2].swipes[0];__betweenLinesApp.refresh()');
  assert.equal(await run('__betweenLinesApp.ledger.articles[0].pages.length'), 3);
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await run('__betweenLinesApp.select(__betweenLinesApp.ledger.articles[0].id);document.querySelector(".bl-writing-section").scrollIntoView({block:"start"})');
  assert.equal(await run('document.querySelector("#bl-codex").scrollWidth<=document.querySelector("#bl-codex").clientWidth'), true);
  await screenshot('qa-writing-mobile-page.png');
  await click('[data-action=write]');
  assert.equal(await run('document.querySelector("#bl-writing-dialog").scrollWidth<=document.querySelector("#bl-writing-dialog").clientWidth'), true);
  await screenshot('qa-writing-mobile-form.png');
  await call('Emulation.setDeviceMetricsOverride', { width: 320, height: 740, deviceScaleFactor: 1, mobile: true });
  assert.equal(await run('document.querySelector("#bl-writing-dialog").scrollWidth<=document.querySelector("#bl-writing-dialog").clientWidth'), true);
  await run('document.querySelector("#bl-writing-dialog").close()');
  assert.deepEqual(errors, []);
  console.log('PASS: manual form and one request; complete literary pages; English prompt and configured language; duplicates; collection retention; JSON/topic/save failures; in-flight language/swipe guards; private notes; mobile 390/320px. All model responses mocked.');
} finally { socket.close(); }
