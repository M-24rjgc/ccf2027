// 抽几帧看效果：node promo/preview.mjs 1.5 6.5 12.8 …  → promo/out/preview-<t>.png
import {writeFileSync, mkdirSync} from 'node:fs';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {launch} from './cdp.mjs';

const out = new URL('./out/', import.meta.url); mkdirSync(out, {recursive: true});
const url = pathToFileURL(fileURLToPath(new URL('./stage.html', import.meta.url))).href + '?render';
const b = await launch();
try {
  await b.goto(url, {width: 1920, height: 1080, settle: 300});
  await b.evaluate('window.READY');
  for (const t of process.argv.slice(2)) {
    await b.evaluate(`seek(${Number(t)})`);
    writeFileSync(new URL(`preview-${t}.png`, out), await b.png());
    console.log('frame', t);
  }
} finally { b.close(); }
