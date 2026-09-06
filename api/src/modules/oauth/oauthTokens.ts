import { randomBytes, createHash } from "node:crypto";

// Opaque, high-entropy tokens — the MCP spec places no requirement on token
// format (unlike a JWT, there is nothing to decode client-side), and an opaque
// value is trivially revocable by deleting its row, which a self-verifying JWT
// is not without an additional denylist.
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

// Only the hash is ever persisted — the same reasoning as not storing a
// plaintext password: a database export or a misconfigured backup should not
// hand out a live, directly-usable credential.
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const AUTHORIZATION_CODE_TTL_MS = 10 * 60 * 1000;
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
