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
  await reset(); await run('await __betweenLinesApp.collect(2);__betweenLinesApp.open();await __betweenLinesApp.generateWriting(__betweenLinesApp.selected,{form:"letter"});window.articleId=__betweenLinesApp.selected');
  const calls = await run('fixture.calls');
  const snapshot = await run('JSON.stringify(ctx.chat[2].extra.between_lines_v1)');
  await click('[data-action=edit-article]');
  await run('document.querySelector("#bl-article-editor [name=name]").value="Discarded"');
  await click('#bl-article-editor footer [data-cancel]');
  assert.equal(await run('JSON.stringify(ctx.chat[2].extra.between_lines_v1)'), snapshot);
  await click('[data-action=edit-article]');
  await screenshot('qa-article-editor.png');
  await run('document.querySelector("#bl-article-editor [name=name]").value="Ночной дозор";document.querySelector("#bl-article-editor [name=details]").value="Моя версия статьи. <img src=x onerror=alert(1)>";document.querySelector("#bl-article-editor [name=facts]").value="Моё наблюдение.";fixture.saveFail=true;document.querySelector("#bl-article-editor form").requestSubmit()');
  await until('!__betweenLinesApp.working');
  assert.equal(await run('JSON.stringify(ctx.chat[2].extra.between_lines_v1)'), snapshot);
  assert.equal(await run('document.querySelector("#bl-article-editor").open'), true);
  await run('fixture.saveFail=false;document.querySelector("#bl-article-editor form").requestSubmit()');
  await until('!__betweenLinesApp.working && !document.querySelector("#bl-article-editor").open');
  assert.equal(await run('__betweenLinesApp.ledger.articles.find(a=>a.id===articleId).name'), 'Ночной дозор');
  assert.equal(await run('__betweenLinesApp.ledger.articles.find(a=>a.id===articleId).pages.length'), 1);
  assert.equal(await run('__betweenLinesApp.ledger.articles.find(a=>a.id===articleId).facts[0].kind'), 'manual');
  assert.equal(await run('document.querySelectorAll(".bl-prose img").length'), 0);
  assert.equal(await run('fixture.calls'), calls);
  await run('await __betweenLinesApp.collect(2,true)');
  assert.equal(await run('__betweenLinesApp.ledger.articles.find(a=>a.id===articleId).name'), 'Ночной дозор');
  // User turns after an assistant response must not lose manual changes or question articles on collection.
  await run('ctx.chat.push({is_user:true,mes:"One more question"});__betweenLinesApp.refresh()');
  await click('[data-action=delete-article]'); await click('#bl-article-delete footer [data-cancel]');
  assert.equal(await run('__betweenLinesApp.ledger.articles.some(a=>a.id===articleId)'), true);
  await click('[data-action=delete-article]'); await click('#bl-article-delete [type=submit]');
  await until('!__betweenLinesApp.working && !document.querySelector("#bl-article-delete").open');
  assert.equal(await run('__betweenLinesApp.ledger.articles.some(a=>a.id===articleId)'), false);
  await run('await __betweenLinesApp.collect(2,true)');
  assert.equal(await run('__betweenLinesApp.ledger.articles.some(a=>a.id===articleId)'), false);
  assert.equal(await run('__betweenLinesApp.ledger.deletedArticles.length'), 1);
  // Literary changes on a new message must preserve deletion markers as well.
  await run('ctx.chat.push({mes:"Another turn"});__betweenLinesApp.refresh();await __betweenLinesApp.generateWriting(__betweenLinesApp.selected,{form:"letter"})');
  assert.equal(await run('__betweenLinesApp.ledger.deletedArticles.length'), 1);
  await click('[data-action=ask]');
  const beforeQuestion = await run('fixture.calls');
  assert.equal(await run('fixture.calls'), beforeQuestion);
  await screenshot('qa-codex-question.png');
  await run('window.prefs=__betweenLinesApp.settings();prefs.language="en";__betweenLinesApp.saveSettings(prefs);fixture.questionResponse={articles:[{...sample.articles[0],facts:sample.articles[0].facts.map(f=>({...f,source:2}))}],terms:[]};document.querySelector("#bl-question input").value="А что такое "+sample.articles[0].name+"?";document.querySelector("#bl-question form").requestSubmit()');
  await until('!__betweenLinesApp.working && !document.querySelector("#bl-question").open');
  assert.equal(await run('fixture.questionCalls'), 1);
  assert.equal(await run('fixture.lastBlock.name'), 'ask');
  assert.equal(await run('/[\u0400-\u04ff]/.test(fixture.lastBlock.prompt)'), false);
  assert.equal(await run('fixture.lastQuestionInput.profile.outputLanguage'), 'English');
  assert.equal(await run('__betweenLinesApp.ledger.deletedArticles.length'), 0);
  assert.equal(await run('__betweenLinesApp.ledger.articles.some(a=>a.name===sample.articles[0].name)'), true);
  await run('await __betweenLinesApp.collect(2,true)');
  assert.equal(await run('__betweenLinesApp.ledger.articles.some(a=>a.name===sample.articles[0].name)'), true);
  const beforeExisting = await run('fixture.calls');
  await click('[data-action=ask]');
  await run('document.querySelector("#bl-question input").value="Что такое "+sample.articles[0].name+"?";document.querySelector("#bl-question form").requestSubmit()');
  await until('!document.querySelector("#bl-question").open');
  assert.equal(await run('fixture.calls'), beforeExisting, 'existing article opens without a model request');
  // A refusal, bad JSON, save failure, and in-flight language/swipe changes do not mutate the codex.
  const beforeFailures = await run('JSON.stringify(ctx.chat[4].extra.between_lines_v1)');
  await click('[data-action=ask]');
  await run('fixture.questionResponse={unavailable:true,reason:"Уточните сеттинг"};document.querySelector("#bl-question input").value="Unknown";document.querySelector("#bl-question form").requestSubmit()');
  await until('!__betweenLinesApp.working');
  assert.equal(await run('document.querySelector("#bl-question .bl-form-error").textContent'), 'Уточните сеттинг');
  assert.equal(await run('document.querySelector("#bl-question").open'), true);
  await run('fixture.badQuestion=true;document.querySelector("#bl-question form").requestSubmit()');
  await until('!__betweenLinesApp.working');
  assert.equal(await run('JSON.stringify(ctx.chat[4].extra.between_lines_v1)'), beforeFailures);
  await run('fixture.badQuestion=false;fixture.questionResponse={articles:[{...sample.articles[0],name:"New topic",aliases:[],facts:[{text:"Supported detail",kind:"chat",source:2}]}],terms:[]};fixture.saveFail=true;document.querySelector("#bl-question form").requestSubmit()');
  await until('!__betweenLinesApp.working');
  assert.equal(await run('JSON.stringify(ctx.chat[4].extra.between_lines_v1)'), beforeFailures);
  await run('fixture.saveFail=false;fixture.wait=true;fixture.finish=null;window.answer=__betweenLinesApp.answerCodexQuestion("Unknown");void 0');
  await until('!!fixture.finish');
  await run('window.prefs=__betweenLinesApp.settings();prefs.language="ru";__betweenLinesApp.saveSettings(prefs);fixture.wait=false;fixture.finish();await answer');
  assert.equal(await run('JSON.stringify(ctx.chat[4].extra.between_lines_v1)'), beforeFailures);
  await run('document.querySelector("#bl-question").close();fixture.wait=true;fixture.finish=null;window.answer=__betweenLinesApp.answerCodexQuestion("Unknown");void 0');
  await until('!!fixture.finish');
  await run('ctx.chatId="another-chat";fixture.wait=false;fixture.finish();await answer');
  assert.equal(await run('JSON.stringify(ctx.chat[4].extra.between_lines_v1)'), beforeFailures);
  await run('ctx.chatId="between-lines-fixture";__betweenLinesApp.refresh()');
  await run('fixture.questionResponse={articles:[{...sample.articles[0],name:"New topic",aliases:[],facts:[{text:"Supported detail",kind:"chat",source:2}]}],terms:[]};window.existingScenes=JSON.stringify([...__betweenLinesApp.ledger.scenes]);await __betweenLinesApp.answerCodexQuestion("New topic")');
  assert.equal(await run('__betweenLinesApp.ledger.articles.some(a=>a.name==="New topic")'), true);
  assert.equal(await run('JSON.stringify([...__betweenLinesApp.ledger.scenes])'), await run('existingScenes'), 'questions do not add glossary terms to story messages');
  await run('await __betweenLinesApp.collect(2,true)');
  assert.equal(await run('__betweenLinesApp.ledger.articles.some(a=>a.name==="New topic")'), true);
  const beforeStaleEdit = await run('JSON.stringify(ctx.chat[4].extra.between_lines_v1)');
  // Stale article forms cannot save after an ancestor edit.
  await click('[data-action=edit-article]');
  await run('ctx.chat[0].mes+=" Edited";document.querySelector("#bl-article-editor form").requestSubmit()');
  await until('!__betweenLinesApp.working');
  assert.equal(await run('JSON.stringify(ctx.chat[4].extra.between_lines_v1)'), beforeStaleEdit);
  await run('document.querySelector("#bl-article-editor").close();ctx.chat[0].mes=ctx.chat[0].mes.replace(" Edited","");__betweenLinesApp.refresh()');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await click('[data-action=edit-article]');
  assert.equal(await run('document.querySelector("#bl-article-editor").scrollWidth<=document.querySelector("#bl-article-editor").clientWidth'), true);
  await screenshot('qa-article-editor-mobile.png');
  await call('Emulation.setDeviceMetricsOverride', { width: 320, height: 740, deviceScaleFactor: 1, mobile: true });
  assert.equal(await run('document.querySelector("#bl-article-editor").scrollWidth<=document.querySelector("#bl-article-editor").clientWidth'), true);
  await run('document.querySelector("#bl-article-editor").close();__betweenLinesApp.askCodexQuestion()');
  assert.equal(await run('document.querySelector("#bl-question").scrollWidth<=document.querySelector("#bl-question").clientWidth'), true);
  assert.deepEqual(errors, []);
  console.log('PASS: article editing/cancel/rollback, preserved literary pages, manual sources, locked edits, confirmed deletion and blocked recollection, explicit questions/restoration, existing lookup, English prompt/output language, refusal/JSON/save/chat/language guards, later user turns, mobile 390/320. All model responses mocked.');
} finally { socket.close(); }
