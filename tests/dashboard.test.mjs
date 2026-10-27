import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const {JSDOM}=createRequire(new URL('../backend/package.json',import.meta.url))('jsdom');

const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const NOW=Date.parse('2026-10-26T14:30:00Z'); // 22:30 Beijing

function load(hash='',mutate){
 const html=read('../site/dashboard.html');
 const dom=new JSDOM(html,{url:'https://site.test/ccf2027/dashboard.html'+hash,runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;
 w.Date.now=()=>NOW;
 w.TextEncoder=TextEncoder;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 w.HTMLDialogElement.prototype.close=function(){if(!this.open)return;this.open=false;this.dispatchEvent(new w.Event('close'));};
 w.URL.createObjectURL=()=>'blob:test';w.URL.revokeObjectURL=()=>{};
 w.eval(read('../site/js/dashboard-data.js'));
 if(mutate)mutate(w.CCF_DASH);
 w.eval(read('../site/js/dashboard.js'));
 return dom;
}
const rows=w=>[...w.document.querySelectorAll('#tb tr')].map(tr=>tr.dataset.uid);

test('dashboard page satisfies the site CSP: local scripts only, no inline code',()=>{
 const html=read('../site/dashboard.html');
 assert.match(html,/Content-Security-Policy[^>]+script-src 'self'/);
 assert.equal(/<script(?![^>]*\ssrc=)[^>]*>/i.test(html),false,'inline <script> block');
 assert.equal(/\son[a-z]+=/i.test(html),false,'inline event handler');
 for(const [,src] of html.matchAll(/<script[^>]+src="([^"]+)"/g))assert.match(src,/^js\/[\w-]+\.js(\?v=\w+)?$/);
 for(const [,v] of html.matchAll(/\?v=(\w+)/g))assert.match(v,/^[0-9a-f]{10}$/,'run python build_html.py to stamp asset hashes');
});

test('renders every conference, open ones first by deadline, closed last',()=>{
 const dom=load();const w=dom.window;const data=w.CCF_DASH.confs;
 const uids=rows(w);
 assert.equal(uids.length,data.length);
 const st=uids.map(u=>data.find(d=>d.uid===u).status);
 const firstTbd=st.indexOf('tbd'),firstClosed=st.indexOf('closed');
 assert.ok(st.slice(0,firstTbd).every(s=>s==='open'));
 assert.ok(st.slice(firstClosed).every(s=>s==='closed'));
 const open=uids.slice(0,firstTbd).map(u=>data.find(d=>d.uid===u).t);
 assert.deepEqual(open,[...open].sort((a,b)=>a-b));
 for(const d of data.filter(d=>d.status==='open'))assert.ok(d.t>NOW);
 assert.equal(w.document.querySelector('#t-all').textContent,String(data.length));
 dom.window.close();
});

test('filters live in the URL hash and agree with the tiles',()=>{
 const dom=load('#ccf=A&st=open&dir='+encodeURIComponent('人工智能'));const w=dom.window;const data=w.CCF_DASH.confs;
 const uids=rows(w);
 assert.ok(uids.length>0);
 for(const u of uids){const d=data.find(x=>x.uid===u);assert.equal(d.ccf,'A');assert.equal(d.status,'open');assert.equal(d.dir,'人工智能');}
 assert.equal(w.document.querySelector('#t-open').textContent,String(uids.length));
 w.document.querySelector('#ccfs [data-ccf="B"]').click();
 assert.match(decodeURIComponent(w.location.hash),/ccf=A,B/);
 assert.ok(rows(w).some(u=>data.find(x=>x.uid===u).ccf==='B'));
 w.document.querySelector('#clr').click();
 assert.equal(w.location.hash,'');
 assert.equal(rows(w).length,data.length);
 dom.window.close();
});

test('search matches across fields and highlights without injecting markup',()=>{
 const evil={...JSON.parse(read('../site/js/dashboard-data.js').slice('window.CCF_DASH = '.length).trim().replace(/;$/,'')).confs[0],
  idx:999,uid:'evil27',abbr:'<img src=x onerror=alert(1)>',full:'"><svg onload=alert(1)>',link:'javascript:alert(1)'};
 const dom=load('#q=img',b=>b.confs.push(evil));const w=dom.window;
 assert.deepEqual(rows(w),['evil27']);
 const tb=w.document.querySelector('#tb');
 assert.equal(tb.querySelector('img,svg[onload]'),null);
 assert.ok(tb.querySelector('mark'));
 tb.querySelector('tr').click();
 assert.equal(w.document.querySelector('#drawer').open,true);
 assert.equal(w.document.querySelector('#dw img,#dw [onerror],#dw a[href^="javascript"]'),null);
 dom.window.close();
});

test('detail drawer opens from a row, deep-links, and closes back to the list',()=>{
 const dom=load();const w=dom.window;
 w.document.querySelector('#tb tr[data-uid="cvpr27"]').click();
 assert.equal(w.document.querySelector('#drawer').open,true);
 assert.match(w.location.hash,/c=cvpr27/);
 assert.match(w.document.querySelector('#dw-title').textContent,/CVPR/);
 assert.match(w.document.querySelector('#dw').textContent,/2026-11-11 19:59/); // abstract deadline shown
 w.document.querySelector('#dw-close').click();
 assert.equal(w.document.querySelector('#drawer').open,false);
 dom.window.close();
 const deep=load('#c=iclr27');
 assert.equal(deep.window.document.querySelector('#drawer').open,true);
 deep.window.close();
});

test('calendar export is valid iCalendar with UTC deadlines and folded lines',()=>{
 const dom=load();const w=dom.window;
 const cvpr=w.CCF_DASH.confs.find(d=>d.uid==='cvpr27');
 const text=w.CCF_DASHBOARD.ics([cvpr],NOW);
 assert.ok(text.startsWith('BEGIN:VCALENDAR\r\n')&&text.endsWith('END:VCALENDAR\r\n'));
 assert.match(text,/DTSTART:20261117T115900Z/); // 2026-11-17 19:59 Beijing
 assert.match(text,/DTSTART:20261111T115900Z/); // abstract
 assert.equal((text.match(/BEGIN:VEVENT/g)||[]).length,2);
 assert.equal((text.match(/BEGIN:VALARM/g)||[]).length,(text.match(/END:VALARM/g)||[]).length);
 for(const line of text.split('\r\n'))assert.ok(Buffer.byteLength(line)<=75,`line too long: ${line}`);
 assert.equal(/[^\r]\n/.test(text),false,'bare LF');
 const past=w.CCF_DASH.confs.find(d=>d.uid==='aaai27');
 assert.equal(w.CCF_DASHBOARD.ics([past],NOW).includes('BEGIN:VEVENT'),false,'past deadlines are not exported');
 dom.window.close();
});

test('dashboard never writes browser storage',()=>{
 const dom=load('#st=soon');const w=dom.window;
 w.document.querySelector('[data-flag="nb"]').click();
 w.document.querySelector('#tb tr')?.click();
 assert.equal(w.localStorage.length,0);assert.equal(w.sessionStorage.length,0);
 dom.window.close();
});

test('untrusted sort keys cannot call inherited object properties',()=>{
 for(const key of ['__proto__','constructor','toString','hasOwnProperty','unknown']) {
  const dom=load('#sort='+key+':1');
  try { assert.equal(dom.window.CCF_DASHBOARD.state().sort.k,'days'); assert.equal(rows(dom.window).length,200); }
  finally {dom.window.close();}
 }
});

test('all imported metadata stays text and official links reject plaintext or credentials',()=>{
 for(const link of ['http://example.test/','https://user:password@example.test/','javascript:alert(1)']) {
  const dom=load('#c=cvpr27',b=>{
   const d=b.confs.find(x=>x.uid==='cvpr27');
   d.ccf='A"><img src="https://evil.test/key" onerror="alert(1)">';
   d.acc=[{y:'<img src="https://evil.test/year">',r:0.2,a:'<img src=x>',s:'<svg onload=alert(1)>'}];
   d.link=link;
  });
  try {
   assert.equal(dom.window.document.querySelector('#tb img,#dw img,#dw [onerror],#dw [onload]'),null);
   assert.equal(dom.window.document.querySelector('#dw a.primary'),null);
  } finally {dom.window.close();}
 }
});

test('calendar metadata cannot inject extra properties, alarms or events',()=>{
 const dom=load();
 try {
  const d=dom.window.CCF_DASH.confs.find(x=>x.uid==='cvpr27');
  d.uid='cvpr\r\nATTACH:https://evil.test/steal\rEND:VEVENT\nBEGIN:VEVENT';
  d.abbr='CVPR\rACTION:EMAIL\nATTENDEE:mailto:evil@example.test';
  const text=dom.window.CCF_DASHBOARD.ics([d],NOW);
  assert.equal((text.match(/^BEGIN:VEVENT$/gm)||[]).length,2);
  assert.ok(!/^(ATTACH|ATTENDEE|ACTION:EMAIL)/m.test(text));
  assert.ok(!/\r(?!\n)|(?<!\r)\n/.test(text));
 } finally {dom.window.close();}
});

test('offline dashboard retains a hash-pinned CSP that disallows network access',()=>{
 const html=read('../CCF2027投稿倒计时看板.html');
 const csp=html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
 assert.match(csp,/connect-src 'none'/);
 assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp));
 for(const [,body] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
  const hash=createHash('sha256').update(body.replace(/\r\n/g,'\n')).digest('base64');
  assert.ok(csp.includes(`'sha256-${hash}'`));
 }
});
