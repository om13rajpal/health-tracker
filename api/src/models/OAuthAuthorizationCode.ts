import { Schema, model } from "mongoose";

// A single-use authorization code from the OAuth 2.1 code+PKCE flow (RFC 7636).
// Only the SHA-256 hash of the code is stored, matching how session secrets
// and passwords in this app are never persisted in a directly-usable form —
// a code is not the same as a password, but a database exposure should not
// hand an attacker a live credential either way.
const oauthAuthorizationCodeSchema = new Schema({
  codeHash: { type: String, required: true, unique: true },
  clientId: { type: String, required: true },
  redirectUri: { type: String, required: true },
  codeChallenge: { type: String, required: true },
  scope: { type: String, default: "" },
  // TTL index: Mongo removes the document once expiresAt passes, so an
  // abandoned authorization attempt (the user never finishes logging in)
  // cleans itself up without a cron job.
  expiresAt: { type: Date, required: true, expires: 0 },
});

export const OAuthAuthorizationCode = model("OAuthAuthorizationCode", oauthAuthorizationCodeSchema);
