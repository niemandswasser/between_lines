import fs from 'node:fs/promises';
const read = async path => (await fs.readFile(new URL(path, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const stripImports = source => source.replace(/^import .*;\r?$/gm, '');
const modules = (await Promise.all(['context.mjs', 'core.mjs', 'writing.mjs', 'articles.mjs', 'auto.mjs'].map(file => read('src/' + file)))).map(stripImports).join('\n');
const names = [...modules.matchAll(/^export (?:const|(?:async )?function) (\w+)/gm)].map(match => match[1]);
const prompts = {};
for (const [key, file] of Object.entries({ collect: 'collection-prompt.txt', write: 'writing-prompt.txt', ask: 'question-prompt.txt' })) {
  prompts[key] = await read('src/' + file);
  if (/[\p{Script=Cyrillic}]/u.test(prompts[key])) throw Error('Prompts must remain English.');
}
const css = (await read('src/styles.css')) + '\n' + (await read('src/writing.css')) + '\n' + (await read('src/connection.css'));
const runtime = `// Between the Lines 2.2.1 — standalone SillyTavern extension.\nconst CORE = (() => {\n${modules.replace(/^export /gm, '')}\nreturn {${names.join(',')}};\n})();\nexport { CORE };\nconst PROMPTS=${JSON.stringify(prompts)};\nconst STYLES=${JSON.stringify(css)};\nconst CONTEXT=CORE;\n${stripImports(await read('src/connection.mjs'))}\n${await read('src/app.js')}\n${await read('src/article-ui.js')}\n${await read('src/connection-ui.js')}\n${await read('src/bootstrap.js')}`;
await fs.writeFile(new URL('runtime.js', import.meta.url), runtime);
await fs.writeFile(new URL('style.css', import.meta.url), css);
console.log('Built standalone codex 2.2.1; bounded context; English prompts; compatible chat storage.');
