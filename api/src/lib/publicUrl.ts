// The OAuth issuer URL must be a single, stable value baked in at app-creation
// time — the whole point of RFC 8414 metadata is that a client discovers it
// once and every endpoint it advertises actually resolves. Deriving it per
// request from req.protocol/req.host would work until the first request that
// arrives through a proxy hop that mangles those headers, silently issuing
// tokens against the wrong issuer.
//
// PUBLIC_BASE_URL is the explicit override; RENDER_EXTERNAL_URL is what
// Render's own platform sets automatically for a web service, so a fresh
// deploy there works without the user having to know this variable exists;
// localhost is the last resort for local development, where RFC 8414 already
// exempts http:// from the HTTPS-only rule.
export function getPublicBaseUrl(): string {
  const configured = process.env.PUBLIC_BASE_URL ?? process.env.RENDER_EXTERNAL_URL;
  if (configured) return configured.replace(/\/+$/, "");
  // Matches this app's own default PORT (see config/env.ts) — only reached in
  // local development, where OAuth discovery is exercised with a local MCP
  // client/inspector rather than the real Claude or ChatGPT.
  return "http://localhost:4000";
}
