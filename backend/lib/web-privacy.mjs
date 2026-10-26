const RULES = ["call for papers", "submission", "deadline", "registration", "reviewer", "reciprocal", "author", "student", "paper limit", "ORCID", "OpenReview", "ARR", "remote", "onsite", "anonymity", "format", "page limit"];
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");

// Rebuild a query from public vocabulary. Never forward arbitrary model/user text.
export function publicSearchQuery(value, conferences) {
  const text = String(value).slice(0,1000);
  const matches = conferences.filter(c => c.abbr && new RegExp(`(^|[^A-Za-z0-9])${escape(c.abbr)}([^A-Za-z0-9]|$)`,"i").test(text));
  const c = matches.sort((a,b)=>b.abbr.length-a.abbr.length)[0];
  if (!c) throw new Error("联网查询需先指定一个知识库中的会议");
  const host = new URL(c.link).hostname;
  const rules = RULES.filter(rule => new RegExp(`\\b${escape(rule)}\\b`,"i").test(text)).slice(0,4);
  return `${c.abbr} 2027 ${rules.join(" ") || "call for papers"} site:${host}`.slice(0,128);
}

export function publicPageUrl(value, conferences) {
  const url = new URL(value);
  const hosts = conferences.map(c => {try{return new URL(c.link).hostname;}catch{return "";}}).filter(Boolean);
  hosts.push("aclrollingreview.org","openreview.net","ccf.org.cn");
  if (url.protocol!=="https:" || url.username || url.password || url.port || url.search || url.hash || !hosts.some(h=>url.hostname===h || url.hostname.endsWith("."+h))) throw new Error("仅支持不含查询参数的 HTTPS 会议官网页面");
  return url.href;
}

export function initialPublicPages(conferences) {
  const pages = new Set();
  for (const c of conferences) {
    try {const url=new URL(c.link);url.protocol="https:";pages.add(publicPageUrl(url.href,conferences));} catch {}
  }
  return pages;
}
