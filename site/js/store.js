// Settings and proposed updates are kept only in this document's memory.
// Remove data retained by earlier releases without reading its contents.
for (const storageName of ["localStorage", "sessionStorage"]) {
  try {
    const storage = globalThis[storageName];
    for (const key of Object.keys(storage)) if (key.startsWith("ccf.")) storage.removeItem(key);
  } catch {}
}

const mem = {};
const ls = {
  get(k) { return mem[k] ?? null; },
  set(k, v) { mem[k] = v; },
};

const DEFAULTS = {
  mode: "shared",
  baseUrl: "https://api.stepfun.com/step_plan/v1",
  model: "step-5-preview",
  stepKey: "",
  deepseekKey: "",
  effort: "auto",
  allowWeb: "false",
  repo: "M-24rjgc/ccf2027",
};

export const Settings = {
  get(k) { const v = ls.get("ccf.set." + k); return v === null ? DEFAULTS[k] : v; },
  set(k, v) { ls.set("ccf.set." + k, v ?? ""); },
  all() { return Object.fromEntries(Object.keys(DEFAULTS).map(k => [k, this.get(k)])); },
  clear() { for (const key of Object.keys(mem)) delete mem[key]; },
};

const PKEY = "ccf.pending";
export const Pending = {
  list() { try { return JSON.parse(ls.get(PKEY) || "[]"); } catch { return []; } },
  save(items) { ls.set(PKEY, JSON.stringify(items)); },
  add(p) {
    const items = this.list();
    const item = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), created: new Date().toISOString(), state: "待审", ...p };
    items.push(item);
    this.save(items);
    return item;
  },
  update(id, patch) { this.save(this.list().map(x => (x.id === id ? { ...x, ...patch } : x))); },
  remove(id) { this.save(this.list().filter(x => x.id !== id)); },
  clear() { this.save([]); },
};
