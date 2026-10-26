// Conversations and drafts live only in this document's memory.
try { sessionStorage.removeItem("ccf.session.v1"); sessionStorage.removeItem("ccf.dashboard.v1"); } catch {}
let current = {};
export function readSession() { return current; }
export function writeSession(value) { current = value; }
export function clearSession() { current = {}; }
