import { Schema, model } from "mongoose";

// An issued OAuth access token, hashed the same way as the authorization code
// it was exchanged from. The TTL index on expiresAt means an hour after
// issuance the row prunes itself — no separate cleanup job, and no way for a
// stale row to be mistaken for a still-valid token after this app's own
// expiry check.
const oauthAccessTokenSchema = new Schema({
  tokenHash: { type: String, required: true, unique: true },
  clientId: { type: String, required: true },
  scope: { type: String, default: "" },
  expiresAt: { type: Date, required: true, expires: 0 },
});

export const OAuthAccessToken = model("OAuthAccessToken", oauthAccessTokenSchema);
