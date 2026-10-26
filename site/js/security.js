export function safeExternalUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

export function modelBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "api.stepfun.com" || url.port || url.username || url.password || url.search || url.hash || !["/v1", "/step_plan/v1"].includes(url.pathname.replace(/\/+$/, ""))) {
    throw new Error("个人模式仅支持 Step 官方 HTTPS 接口");
  }
  return url.href.replace(/\/+$/, "");
}

export function configureMarkdown(purify, markdown, linkify) {
  purify.addHook("afterSanitizeAttributes", node => {
    if (node.tagName !== "A") return;
    const href = node.getAttribute("href") || "";
    if (href.startsWith("#")) return;
    const safe = safeExternalUrl(href);
    if (!safe) node.removeAttribute("href");
    else {
      node.setAttribute("href", safe);
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
      node.setAttribute("referrerpolicy", "no-referrer");
    }
  });
  markdown.use({gfm:true,breaks:false});
  return text => purify.sanitize(markdown.parse(linkify(text || "")), {
    ALLOWED_TAGS:["a","p","br","strong","em","del","s","blockquote","code","pre","ul","ol","li","h1","h2","h3","h4","h5","h6","hr","table","thead","tbody","tr","th","td","span","div","sup","sub"],
    ALLOWED_ATTR:["href","title","class","data-id","colspan","rowspan"],
    ALLOW_DATA_ATTR:false,
    ALLOW_ARIA_ATTR:false,
  });
}
