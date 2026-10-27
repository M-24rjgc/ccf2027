// 录制固定公开示例（共享服务模式、只用知识库、不联网），消耗共享问答额度。
// 不读取 .env 或个人 Key；截图、回答和查询记录仅写入被 Git 忽略的 assets/agent/。
// 先运行：python -m http.server 8765 --directory site（必须用 localhost，见 README）
import {writeFileSync, mkdirSync, rmSync} from 'node:fs';
import {launch, sleep} from './cdp.mjs';
import {captureSite, DEMO_QUESTION} from './security.mjs';

const SITE = captureSite(process.env.SITE || 'http://localhost:8765');
const QUESTION = DEMO_QUESTION;
if (process.argv.length > 2) throw new Error('宣传录制仅支持脚本内的公开示例，不接受私人问题参数');

const OUT = new URL('./assets/agent/', import.meta.url);
rmSync(OUT, {recursive: true, force: true}); mkdirSync(OUT, {recursive: true});
const b = await launch();
const jpg = async name => { const r = await b.send('Page.captureScreenshot', {format: 'jpeg', quality: 92}, 15000); writeFileSync(new URL(name, OUT), Buffer.from(r.data, 'base64')); };
const png = async name => writeFileSync(new URL(name, OUT), await b.png());
const log = [];
try {
  await b.goto(`${SITE}/index.html`, {width: 1440, height: 900, dpr: 2, settle: 1800});
  await b.send('Emulation.setFocusEmulationEnabled', {enabled: true});
  await b.evaluate(`(() => {
    document.querySelector('#btn-settings').click();
    const f = document.querySelector('#settings-form');
    f.elements.mode.value = 'shared'; f.elements.mode.dispatchEvent(new Event('change'));
    document.querySelector('#dlg-settings').close('save');
  })()`);
  await sleep(400);
  await b.evaluate(`(() => {
    if (document.querySelector('#dlg-settings').open) throw new Error('settings dialog still open');
    document.querySelector('#service-status').style.visibility = 'hidden';
    const box = document.querySelector('#input'); box.value = ${JSON.stringify(QUESTION)};
    box.dispatchEvent(new Event('input', {bubbles: true})); box.focus();
  })()`);
  await png('typed.png');
  await b.evaluate(`document.querySelector('#composer').requestSubmit()`);
  const t0 = Date.now();
  for (let i = 0; ; i++) {
    await sleep(1500);
    const s = await b.evaluate(`(() => {
      const ai = [...document.querySelectorAll('.msg.ai')].pop(); if (!ai) return null;
      const proc = ai.querySelector('.proc'); if (proc && !proc.hidden) proc.open = true;
      const msgs = document.querySelector('#msgs'); msgs.scrollTop = msgs.scrollHeight;
      return {steps: ai.querySelectorAll('.proc li').length, status: ai.querySelector('.answer-status')?.hidden ? '' : ai.querySelector('.answer-status')?.textContent,
        chars: ai.querySelector('.body').textContent.length, done: document.querySelector('#btn-send').textContent === '发送'};
    })()`);
    const t = (Date.now() - t0) / 1000;
    log.push({i, t, ...s});
    await jpg(`run-${String(i).padStart(3, '0')}.jpg`);
    console.log(`t=${t.toFixed(0)}s steps=${s?.steps} chars=${s?.chars} ${s?.status || ''}`);
    if (s?.done && i > 0) break;
    if (t > 420) throw new Error('agent run timed out');
  }
  const result = await b.evaluate(`(() => {
    const ai = [...document.querySelectorAll('.msg.ai')].pop();
    return {
      route: ai.querySelector('.meta')?.innerText || '',
      steps: [...ai.querySelectorAll('.proc li')].map(li => ({tool: li.querySelector('.tn')?.textContent, args: li.querySelector('.muted')?.textContent, result: li.querySelector('.tr')?.textContent})),
      answer: ai.querySelector('.body').innerText,
      answerHtml: ai.querySelector('.body').innerHTML,
      foot: ai.querySelector('.foot').innerText,
    };
  })()`);
  writeFileSync(new URL('trace.json', OUT), JSON.stringify({question: QUESTION, at: new Date().toISOString(), log, ...result}, null, 1));
  // the finished answer, top to bottom
  const h = await b.evaluate(`(() => { const m = document.querySelector('#msgs'); const ai = [...document.querySelectorAll('.msg.ai')].pop(); return {top: ai.offsetTop - 12, max: m.scrollHeight - m.clientHeight, view: m.clientHeight}; })()`);
  let k = 0;
  for (let y = Math.max(0, h.top - 220); k < 6; y += Math.round(h.view * 0.8), k++) {
    await b.evaluate(`document.querySelector('#msgs').scrollTop = ${Math.min(y, h.max)}`); await sleep(250);
    await png(`answer-${k}.png`);
    if (y >= h.max) break;
  }
  // the reasoning path on the knowledge graph
  await b.evaluate(`[...document.querySelectorAll('.msg.ai .foot button')].find(x => x.textContent.startsWith('查看引用关系')).click()`);
  await sleep(2500);
  await png('graph-path.png');
  console.log('done in', ((Date.now() - t0) / 1000).toFixed(0), 's;', result.steps.length, 'tool calls;', result.foot);
} finally { b.close(); }
