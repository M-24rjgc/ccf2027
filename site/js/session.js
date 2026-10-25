const KEY = "ccf.session.v1";
export function readSession() {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) || "{}");
    if (!value || typeof value !== "object") return {};
    return value;
  } catch { return {}; }
}
export function writeSession(value) {
  try { sessionStorage.setItem(KEY, JSON.stringify(value)); } catch { /* Storage can be disabled or full. */ }
}
