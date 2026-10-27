// 截取宣传片用到的真实界面。先在仓库根目录运行：python -m http.server 8765 --directory site
import {writeFileSync, mkdirSync} from 'node:fs';
import {launch, sleep} from './cdp.mjs';

const SITE = process.env.SITE || 'http://localhost:8765';
const OUT = new URL('./assets/', import.meta.url);
mkdirSync(OUT, {recursive: true});
const b = await launch();
const save = async (name, opts) => { writeFileSync(new URL(name, OUT), await b.png(opts)); console.log('saved', name); };
const desk = {width: 1440, height: 900, dpr: 2};
try {
  await b.goto(`${SITE}/dashboard.html`, desk);
  await save('dash.png');

  await b.goto(`${SITE}/dashboard.html#ccf=A,B&st=open&dir=${encodeURIComponent('人工智能')}`, desk);
  await save('dash-filter.png');

  await b.goto(`${SITE}/dashboard.html#c=cvpr27`, desk);
  await save('dash-drawer.png');

  await b.goto(`${SITE}/dashboard.html`, {width: 390, height: 844, dpr: 3, mobile: true});
  // start the phone screen at the result count, cards below
  await b.evaluate(`window.scrollTo(0, document.querySelector('#results').getBoundingClientRect().top + scrollY - 76)`); await sleep(300);
  await save('dash-mobile.png');

  // 问答页：只把示例问题填进输入框，不发送；隐藏与宣传无关的连接状态
  await b.goto(`${SITE}/index.html`, {...desk, settle: 1500});
  await b.evaluate(`(() => {
    document.querySelector('#service-status').style.visibility = 'hidden';
    document.querySelector('#input').focus();
  })()`);
  await save('chat-empty.png'); // the stage types the question over this frame
  await b.evaluate(`(() => {
    const q = [...document.querySelectorAll('#examples button')].map(x => x.textContent).find(t => t.includes('联邦学习'));
    const box = document.querySelector('#input'); box.value = q; box.setSelectionRange(q.length, q.length);
  })()`);
  await save('chat.png');

  await b.goto(`${SITE}/index.html#library`, {...desk, settle: 1500});
  await b.evaluate(`(() => {
    document.querySelector('#service-status').style.visibility = 'hidden';
    document.querySelector('#tab-graph').click();
  })()`);
  await sleep(1500);
  await b.evaluate(`(() => { const g = document.querySelector('#gsearch'); g.value = 'CVPR'; document.querySelector('#g-search').click(); })()`);
  await sleep(1800);
  await save('graph.png');

  await b.goto(`${SITE}/index.html#cvpr27`, {...desk, settle: 1500});
  await b.evaluate(`document.querySelector('#service-status').style.visibility = 'hidden'`);
  await save('page.png');

  // wiki concept page: one concept linking many conferences
  await b.goto(`${SITE}/index.html#reciprocal-review`, {...desk, settle: 1500});
  await b.evaluate(`document.querySelector('#service-status').style.visibility = 'hidden'`);
  await save('concept.png');

  // submission details: conferences with newbie-author clauses, and one conference's rules
  await b.goto(`${SITE}/dashboard.html#nb=1&ccf=A`, desk);
  await save('dash-nb.png');
  await b.goto(`${SITE}/dashboard.html#c=chi27`, desk);
  await b.evaluate(`document.querySelector('.dw-body').scrollTop = 470`); await sleep(300);
  await save('drawer-rules.png');
} finally { b.close(); }
