import { Schema, model } from "mongoose";

// A dynamically-registered OAuth client (RFC 7591) — one document per app that
// has ever asked to connect (Claude, ChatGPT, a future client). Storing the
// full registration response verbatim under `data` means the shape can grow
// with whatever optional metadata a client sends without a migration.
const oauthClientSchema = new Schema({
  clientId: { type: String, required: true, unique: true },
  data: { type: Schema.Types.Mixed, required: true },
  createdAt: { type: Date, default: Date.now },
});

export const OAuthClient = model("OAuthClient", oauthClientSchema);
