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
  await call('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
  await reset();
  assert.equal(await run('fixture.calls'), 0, 'mounting UI never generates');
  await run('await __betweenLinesApp.collect(2)');
  assert.equal(await run('fixture.calls'), 1);
  assert.equal(await run('ctx.chat[2].extra.extblocks'), 'untouched');
  assert.equal(await run('ctx.chat[2].swipe_info[0].extra.between_lines_v1.articles.length'), 3);
  assert.equal(await run('document.querySelectorAll(".bl-term-chips [data-term-id]").length'), 3);
  assert.equal(await run('document.querySelector(".bl-terms").getBoundingClientRect().height < 130'), true);
  assert.equal(await run('fixture.lastInput.profile.outputLanguage'), 'Russian');
  assert.equal(await run('/[\u0400-\u04ff]/.test(fixture.lastBlock.prompt)'), false);
  await screenshot('qa-new-chat.png');
  await click('.bl-term-chips [data-term-id]');
  assert.equal(await run('document.querySelector(".bl-definition").hidden'), false);
  await click('[data-term-article]');
  assert.equal(await run('document.querySelector("#bl-codex").open'), true);
  assert.equal(await run('document.querySelector(".bl-article-header h2").textContent'), 'Серый дозор');
  await click('[data-action=favorite]'); await click('[data-scope=favorites]');
  assert.equal(await run('document.querySelectorAll(".bl-entry").length'), 1);
  await run('document.querySelector("#bl-note").value="Личная заметка, не отправлять модели";document.querySelector("#bl-note").dispatchEvent(new Event("input",{bubbles:true}))');
  await click('[data-action=settings]');
  await run('document.querySelector("#bl-language").value="en";document.querySelector("#bl-language").dispatchEvent(new Event("change"));document.querySelector("#bl-settings form").requestSubmit()');
  assert.equal(await run('fixture.calls'), 1, 'saving language never generates');
  assert.equal(await run('ctx.chatMetadata.between_lines_preferences_v1.language'), 'en');
  await run('await __betweenLinesApp.collect(2,true)');
  assert.equal(await run('fixture.lastInput.profile.outputLanguage'), 'English');
  assert.equal(await run('fixture.lastBlock.prompt.includes("OUTPUT LANGUAGE FOR THIS REQUEST: English")'), true);
  assert.equal(await run('JSON.stringify(fixture.lastInput).includes("Личная заметка")'), false);
  assert.equal(await run('__betweenLinesApp.ledger.articles.length'), 3);
  assert.equal(await run('__betweenLinesApp.ledger.articles[0].definition'), 'A world reference in English.');
  await run('window.savedMeta=structuredClone(ctx.chatMetadata);__betweenLinesApp.dialog.close();__betweenLinesApp.open()');
  assert.equal(await run('__betweenLinesApp.settings().favorites.length'), 1);
  assert.equal(await run('document.querySelector("#bl-note").value'), 'Личная заметка, не отправлять модели');
  await click('[data-scope=all]');
  await run('document.querySelector("#bl-search").value="разрешения";document.querySelector("#bl-search").dispatchEvent(new Event("input"))');
  // Definitions are now English; search the stable proper-name identity.
  await run('document.querySelector("#bl-search").value="Соляные";document.querySelector("#bl-search").dispatchEvent(new Event("input"))');
  assert.equal(await run('document.querySelectorAll(".bl-entry").length'), 1);
  await run('document.querySelector("#bl-search").value="";document.querySelector("#bl-search").dispatchEvent(new Event("input"));document.querySelector("#bl-category").value="faction";document.querySelector("#bl-category").dispatchEvent(new Event("change"))');
  assert.equal(await run('document.querySelectorAll(".bl-entry").length'), 1);
  await run('document.querySelector("#bl-category").value="all";document.querySelector("#bl-category").dispatchEvent(new Event("change"))');
  await click('[data-scope=scene]');
  assert.equal(await run('document.querySelectorAll(".bl-entry").length'), 3);
  // Preserve snapshots through bad JSON and save failures.
  const saved = await run('JSON.stringify(ctx.chat[2].extra.between_lines_v1)');
  await run('fixture.badJSON=true;await __betweenLinesApp.collect(2,true);fixture.badJSON=false');
  assert.equal(await run('JSON.stringify(ctx.chat[2].extra.between_lines_v1)'), saved);
  await run('fixture.saveFail=true;await __betweenLinesApp.collect(2,true);fixture.saveFail=false');
  assert.equal(await run('JSON.stringify(ctx.chat[2].extra.between_lines_v1)'), saved);
  // Changing language during a request must discard the old response.
  await run('fixture.wait=true;fixture.finish=null;window.request=__betweenLinesApp.collect(2,true);void 0');
  await until('!!fixture.finish');
  await run('window.prefs=__betweenLinesApp.settings();prefs.language="de";__betweenLinesApp.saveSettings(prefs);fixture.wait=false;fixture.finish();await request');
  assert.equal(await run('JSON.stringify(ctx.chat[2].extra.between_lines_v1)'), saved);
  await run('prefs.language="ru";__betweenLinesApp.saveSettings(prefs);await __betweenLinesApp.collect(2,true)');
  await click('[data-scope=all]');
  await screenshot('qa-new-codex.png');
  await click('[data-action=settings]'); await screenshot('qa-new-settings.png');
  await run('document.querySelector("#bl-language").value="custom";document.querySelector("#bl-language").dispatchEvent(new Event("change"));document.querySelector("[name=customLanguage]").value="Turkish";document.querySelector("#bl-settings form").requestSubmit()');
  assert.equal(await run('__betweenLinesApp.core.collectionProfile(__betweenLinesApp.settings()).outputLanguage'), 'Turkish');
  // Swipes restore independent data; edits invalidate descendants.
  await run('ctx.chat[2].swipe_id=1;ctx.chat[2].mes=ctx.chat[2].swipes[1];await emit("MESSAGE_SWIPED");__betweenLinesApp.refresh()');
  assert.equal(await run('__betweenLinesApp.ledger.articles.length'), 0);
  assert.equal(await run('document.querySelectorAll(".bl-terms").length'), 0);
  await run('ctx.chat[2].swipe_id=0;ctx.chat[2].mes=ctx.chat[2].swipes[0];await emit("MESSAGE_SWIPED");__betweenLinesApp.refresh()');
  assert.equal(await run('__betweenLinesApp.ledger.articles.length'), 3);
  await run('window.originalQuestion=ctx.chat[1].mes;ctx.chat[1].mes="Changed question";await emit("MESSAGE_EDITED");__betweenLinesApp.refresh()');
  assert.equal(await run('__betweenLinesApp.ledger.articles.length'), 0);
  await run('ctx.chat[1].mes=originalQuestion;__betweenLinesApp.refresh()');
  // A new chat discards pending model output and has separate preferences.
  const beforeChatChange = await run('JSON.stringify(ctx.chat[2].extra.between_lines_v1)');
  await run('fixture.wait=true;fixture.finish=null;window.request=__betweenLinesApp.collect(2,true);void 0'); await until('fixture.finish && __betweenLinesApp.working');
  await run('ctx.chatId="other-chat";ctx.chatMetadata={};await emit("CHAT_CHANGED");fixture.wait=false;fixture.finish();await request');
  assert.equal(await run('JSON.stringify(ctx.chat[2].extra.between_lines_v1)'), beforeChatChange, 'switching chats must discard the delayed response');
  assert.equal(await run('__betweenLinesApp.settings().language'), 'ru');
  await run('ctx.chatId="between-lines-fixture";ctx.chatMetadata=savedMeta;await emit("CHAT_CHANGED")');
  await run('ctx.extensionSettings.between_lines_extension.enabled=false;__betweenLinesApp.refresh()');
  assert.equal(await run('document.querySelectorAll(".bl-terms").length'), 0);
  await run('ctx.extensionSettings.between_lines_extension.enabled=true;__betweenLinesApp.refresh();__betweenLinesApp.dialog.close()');
  const calls = await run('fixture.calls');
  await click('.bl-term-chips [data-term-id]');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await run('document.querySelector(".bl-terms").scrollIntoView({block:"center"})');
  assert.equal(await run('document.documentElement.scrollWidth <= innerWidth'), true);
  await screenshot('qa-new-mobile-terms.png');
  await click('[data-term-article]');
  assert.equal(await run('getComputedStyle(document.querySelector("#bl-reader")).display'), 'block');
  assert.equal(await run('document.querySelector("#bl-codex").scrollWidth <= document.querySelector("#bl-codex").clientWidth'), true);
  await screenshot('qa-new-mobile-codex.png');
  await click('[data-action=settings]');
  assert.equal(await run('document.querySelector("#bl-settings").scrollWidth <= document.querySelector("#bl-settings").clientWidth'), true);
  await screenshot('qa-new-mobile-settings.png');
  await run('document.querySelector("#bl-settings").close()');
  await call('Emulation.setDeviceMetricsOverride', { width: 320, height: 740, deviceScaleFactor: 1, mobile: true });
  assert.equal(await run('document.querySelector("#bl-codex").scrollWidth <= document.querySelector("#bl-codex").clientWidth'), true);
  await click('[data-action=list]');
  assert.equal(await run('document.querySelector("#bl-codex").scrollWidth <= document.querySelector("#bl-codex").clientWidth'), true);
  assert.equal(await run('fixture.calls'), calls, 'reading and mobile navigation never generate');
  // Generated text is displayed as text, including hostile HTML-looking content.
  await run('window.hostile=structuredClone(sample);hostile.articles[0].definition="<img src=x onerror=alert(1)>";fixture.response=hostile;await __betweenLinesApp.collect(2,true);fixture.response=null');
  assert.equal(await run('document.querySelectorAll(".bl-terms img,#bl-reader img").length'), 0);
  assert.equal(await run('__betweenLinesApp.ledger.articles[0].definition'), '<img src=x onerror=alert(1)>');
  assert.deepEqual(errors, []);
  console.log('PASS: independent blocks; mounting; English prompt and configurable output; scene glossary; full articles; search/filters; favorites/notes; source permissions; bad JSON and save rollback; language/chat/swipe/edit guards; mobile 390/320px. No real model requests or browser exceptions.');
} finally { socket.close(); }
