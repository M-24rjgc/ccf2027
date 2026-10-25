import { Settings, Pending } from "./store.js?v=shared-20261025";

export const SERVICE_URL = "https://ccf2027-api-m24rjgc.decent-hill-0315.chatgpt.site";
export const sharedMode = () => Settings.get("mode") !== "personal";

export async function serviceHealth() {
  const res = await fetch(`${SERVICE_URL}/api/health`, { signal: AbortSignal.timeout(15000), credentials: "omit" });
  const data = await res.json();
  return { ...data, ready: res.ok && data.ready === true };
}

export async function askShared(history, text, ui) {
  const res = await fetch(`${SERVICE_URL}/api/ask`, {
    method: "POST", credentials: "omit", signal: ui.signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, history: history.slice(-8), effort: Settings.get("effort") || "auto" }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `问答服务暂时不可用（${res.status}）`);
  }
  if (!res.headers.get("content-type")?.includes("text/event-stream")) throw new Error("问答服务返回异常，请稍后重试");
  const reader = res.body.getReader(), decoder = new TextDecoder();
  let buffer = "", result;
  function event(block) {
    const name = block.split("\n").find(l => l.startsWith("event:"))?.slice(6).trim();
    const raw = block.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trim()).join("\n");
    if (!name || !raw) return;
    const data = JSON.parse(raw);
    switch (name) {
      case "route": ui.onRoute?.(data); break;
      case "step": ui.onStep?.(data); break;
      case "delta": ui.onDelta?.({ content: data.content || "" }, data.step); break;
      case "tool_start": ui.onToolStart?.(data.name, data.args); break;
      case "tool_end": ui.onToolEnd?.(data.name, data.args, data.result); break;
      case "pending": Pending.add(data); ui.onPending?.(data); break;
      case "done": result = { ...data, visited: new Map(data.visited) }; break;
      case "error": throw new Error(data.message || "本次回答未完成，请重试");
    }
  }
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replace(/\r\n/g, "\n");
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) { event(buffer.slice(0, end)); buffer = buffer.slice(end + 2); }
      if (done) break;
    }
    if (!result) throw new Error("连接中断，回答未完成，请重试");
    return result;
  } finally { await reader.cancel().catch(() => {}); }
}
