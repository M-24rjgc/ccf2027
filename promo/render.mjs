// 逐帧渲染 stage.html → promo/ccf2027-promo.mp4（1920×1080，30fps，H.264 + AAC）
// 先把帧写到 promo/out/frames/（JPEG q95），再交给 ffmpeg 编码；边截边往 ffmpeg 管道里写在 Windows 上会卡死。
// 依赖：Edge/Chrome；ffmpeg（PATH 里的，或 FFMPEG=路径，或 pip install imageio-ffmpeg）；先运行 python promo/music.py
// 加 --keep 保留帧文件
import {spawnSync, execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {launch} from './cdp.mjs';

const FPS = 30;
const here = p => fileURLToPath(new URL(p, import.meta.url));
function ffmpegPath() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  try { return execFileSync('python', ['-c', 'import imageio_ffmpeg as f; print(f.get_ffmpeg_exe())'], {encoding: 'utf8'}).trim(); } catch {}
  return 'ffmpeg';
}
const music = here('./out/music.wav');
if (!existsSync(music)) throw new Error('missing promo/out/music.wav — run: python promo/music.py');
const dir = here('./out/frames/');
rmSync(dir, {recursive: true, force: true}); mkdirSync(dir, {recursive: true});
const out = here('./ccf2027-promo.mp4');

const t0 = Date.now();
const b = await launch();
let frames;
try {
  await b.goto(pathToFileURL(here('./stage.html')).href + '?render', {width: 1920, height: 1080, settle: 300});
  await b.evaluate('window.READY');
  frames = Math.round((await b.evaluate('window.DURATION')) * FPS);
  const shot = async () => {
    for (let attempt = 1; ; attempt++) {
      try { return await b.send('Page.captureScreenshot', {format: 'jpeg', quality: 95}, 8000); }
      catch (e) {
        if (attempt >= 4) throw e;
        console.log(`  capture stalled, nudging the page (attempt ${attempt})`);
        await b.send('Page.bringToFront', {}, 5000).catch(() => {});
        await b.send('Emulation.setFocusEmulationEnabled', {enabled: true}, 5000).catch(() => {});
      }
    }
  };
  await b.send('Emulation.setFocusEmulationEnabled', {enabled: true});
  for (let f = 0; f < frames; f++) {
    await b.evaluate(`seek(${(f / FPS).toFixed(5)})`);
    const r = await shot();
    writeFileSync(`${dir}${String(f).padStart(4, '0')}.jpg`, Buffer.from(r.data, 'base64'));
    if (f % 90 === 0) console.log(`frame ${f}/${frames} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
} finally { b.close(); }

console.log('encoding…');
const ff = spawnSync(ffmpegPath(), ['-y', '-loglevel', 'error',
  '-framerate', String(FPS), '-i', `${dir}%04d.jpg`, '-i', music, '-map', '0:v', '-map', '1:a',
  // JPEG frames decode as full-range; convert to standard limited-range BT.709 so every player shows the same colors
  '-vf', 'scale=in_range=pc:out_range=tv:out_color_matrix=bt709:flags=lanczos+accurate_rnd,format=yuv420p',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-profile:v', 'high', '-tune', 'animation',
  '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
  '-c:a', 'aac', '-b:a', '192k', '-t', String(frames / FPS), '-movflags', '+faststart', out], {stdio: 'inherit'});
if (ff.status) throw new Error('ffmpeg exited ' + ff.status);
if (!process.argv.includes('--keep')) rmSync(dir, {recursive: true, force: true});
console.log('saved', out, `in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
