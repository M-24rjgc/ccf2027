// Recording is restricted to the public demo and a local preview or the published app.
export const DEMO_QUESTION = '我做联邦学习里的隐私保护，学生一作，想投三个月内截稿、最好能远程参会的 B 类以上会议，帮我列候选。';

export function captureSite(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('录制地址无效'); }
  const local = url.protocol === 'http:' && url.hostname === 'localhost' && url.port === '8765' && url.pathname === '/';
  const published = url.origin === 'https://m-24rjgc.github.io' && ['/ccf2027', '/ccf2027/'].includes(url.pathname);
  if ((!local && !published) || url.username || url.password || url.search || url.hash) throw new Error('录制仅支持 localhost:8765 或已发布的 CCF 会议助手');
  return url.href.replace(/\/$/, '');
}
