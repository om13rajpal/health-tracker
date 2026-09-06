import { Schema, model } from "mongoose";

// A refresh token, rotated on every use: exchanging one deletes it and issues
// a fresh access/refresh pair, so a leaked-then-replayed refresh token stops
// working the moment the legitimate client next refreshes. The generous
// ninety-day expiry is what lets Claude or ChatGPT keep the connection alive
// across sessions without asking this single user to re-enter the app
// password every hour.
const oauthRefreshTokenSchema = new Schema({
  tokenHash: { type: String, required: true, unique: true },
  clientId: { type: String, required: true },
  scope: { type: String, default: "" },
  expiresAt: { type: Date, required: true, expires: 0 },
});

export const OAuthRefreshToken = model("OAuthRefreshToken", oauthRefreshTokenSchema);
