export function rejectUnsafeRequest(request) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/_next/image") || url.pathname.startsWith("/__") || request.headers.has("next-action")) return new Response("Not found", {status:404});
  if (!["GET","HEAD","OPTIONS"].includes(request.method) && !["/api/ask","/api/admin/limits"].includes(url.pathname)) return new Response("Method not allowed", {status:405});
  return null;
}

export function protectResponse(response, request) {
  const result = new Response(response.body, response);
  const h=result.headers;
  h.set("X-Content-Type-Options","nosniff");
  h.set("Referrer-Policy","no-referrer");
  h.set("X-Frame-Options","DENY");
  h.set("Permissions-Policy","camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  h.set("Cross-Origin-Opener-Policy","same-origin");
  if (new URL(request.url).protocol === "https:") h.set("Strict-Transport-Security","max-age=31536000");
  h.set("Cache-Control","no-store");
  h.set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  return result;
}
