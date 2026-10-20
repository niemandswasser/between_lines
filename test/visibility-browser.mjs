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
  await call('Runtime.enable'); await call('Page.enable'); await reset();
  await run('await app.collect(2,true);app.open();await app.generateWriting(app.selected,{form:"letter"});window.before=JSON.stringify(app.ledger.articles)');
  const calls = await run('fixture.calls');
  await run('ctx.chat[0].is_system=true;ctx.chat[1].is_system=true;ctx.chat[2].is_system=true;app.refresh()');
  assert.equal(await run('JSON.stringify(app.ledger.articles)'), await run('before'));
  assert.equal(await run('document.querySelectorAll(".bl-entry").length'), 3);
  await click('[data-action=edit-article]');
  await run('document.querySelector("#bl-article-editor [name=definition]").value="My manual definition";document.querySelector("#bl-article-editor form").requestSubmit()');
  await until('!app.working && !document.querySelector("#bl-article-editor").open');
  assert.equal(await run('app.ledger.articles.find(a=>a.id===app.selected).pages.length'), 1);
  await run('ctx.chat[0].is_system=false;ctx.chat[1].is_system=false;ctx.chat[2].is_system=false;app.refresh()');
  assert.equal(await run('app.ledger.articles.find(a=>a.id===app.selected).definition'), 'My manual definition');
  assert.equal(await run('fixture.calls'), calls);
  // Simulate 2.1 snapshots created with an earlier hidden-prefix boundary.
  await reset();
  await run(`window.oldHash=(text)=>app.core.hash(text);ctx.chat[0].is_system=true;let prev='start';window.oldBranches=ctx.chat.map(m=>prev=oldHash(prev+'|'+(m.is_user?'u':'a')+'|'+(m.is_system?'s':'')+'|'+(m.swipe_id??0)+'|'+m.mes));window.known=app.core.integrate([],app.core.decodeCollection(JSON.stringify(sample),app.core.collectionInput(ctx.chat,2,[],{})),2);window.legacy={format:1,branch:oldBranches[2],swipe:0,articles:known.articles,terms:known.terms};ctx.chat[2].extra.between_lines_v1=structuredClone(legacy);ctx.chat[2].swipe_info=[{extra:{between_lines_v1:structuredClone(legacy)}}];ctx.chat[1].is_system=true;app.refresh();app.open()`);
  assert.equal(await run('app.ledger.articles.length'), 3);
  assert.equal(await run('ctx.chat[2].extra.between_lines_v1.branchFormat'), 2);
  assert.equal(await run('ctx.chat[2].swipe_info[0].extra.between_lines_v1.branchFormat'), 2);
  assert.equal(await run('fixture.saves'), 1, 'legacy compatibility persisted through Tavern saveChat');
  assert.equal(await run('fixture.calls'), 0, 'recovery requires no model request');
  await run('ctx.chat[0].is_system=false;ctx.chat[1].is_system=false;ctx.chat[2].is_system=true;ctx.chat=JSON.parse(JSON.stringify(ctx.chat));app.refresh()');
  assert.equal(await run('app.ledger.articles.length'), 3);
  await run('ctx.chat[1].mes+=" Actual edit";app.refresh()');
  assert.equal(await run('app.ledger.articles.length'), 0);
  await run('ctx.chat[1].mes=ctx.chat[1].mes.replace(" Actual edit","");ctx.chat[2].is_system=false;ctx.chat[2].swipe_id=1;ctx.chat[2].mes=ctx.chat[2].swipes[1];app.refresh()');
  assert.equal(await run('app.ledger.articles.length'), 0);
  await run('ctx.chat[2].swipe_id=0;ctx.chat[2].mes=ctx.chat[2].swipes[0];app.refresh()');
  assert.equal(await run('app.ledger.articles.length'), 3);
  await reset();
  await run(`window.saveLegacy=(id,article)=>{let p='start';for(let i=0;i<=id;i++){const m=ctx.chat[i];p=app.core.hash(p+'|'+(m.is_user?'u':'a')+'|'+(m.is_system?'s':'')+'|'+(m.swipe_id??0)+'|'+m.mes);}ctx.chat[id].extra={between_lines_v1:{format:1,branch:p,swipe:0,articles:[article],terms:[article.id]}};};saveLegacy(2,{...sample.articles[0],id:'original',name:'Grey Watch',aliases:['Watch']});ctx.chat[0].is_system=true;ctx.chat.push({mes:'Another reply'});saveLegacy(3,{...sample.articles[0],id:'recreated',name:'Watch',aliases:[]});ctx.chat[1].is_system=true;ctx.chatMetadata.between_lines_preferences_v1={notes:{original:'Old private note',recreated:'Recent private note'},favorites:['recreated']};app.refresh();app.open()`);
  assert.equal(await run('app.ledger.articles.length'), 1);
  assert.equal(await run('app.ledger.articles[0].id'), 'original');
  assert.equal(await run('app.settings().notes.original.includes("Old private note") && app.settings().notes.original.includes("Recent private note")'), true);
  assert.equal(await run('app.settings().favorites.includes("original")'), true);
  assert.equal(await run('app.ledger.scenes.get(3)[0]'), 'original');
  assert.equal(await run('fixture.calls'), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: hidden sources/anchors retain codex and pages; manual edits while hidden; legacy prefix-hide recovery; both copies migrated and saved without model requests; serialization; real edits and swipes still invalidate.');
} finally { socket.close(); }
