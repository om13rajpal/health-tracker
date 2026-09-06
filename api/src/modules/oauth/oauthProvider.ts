import type { Response } from "express";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { OAuthClientInformationFull, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { InvalidGrantError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { constantTimeEquals } from "../../lib/crypto.js";
import { OAuthClient } from "../../models/OAuthClient.js";
import { OAuthAuthorizationCode } from "../../models/OAuthAuthorizationCode.js";
import { OAuthAccessToken } from "../../models/OAuthAccessToken.js";
import { OAuthRefreshToken } from "../../models/OAuthRefreshToken.js";
import { renderLoginPage } from "./oauthLoginPage.js";
import {
  AUTHORIZATION_CODE_TTL_MS,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_MS,
  generateToken,
  hashToken,
} from "./oauthTokens.js";

// A token that effectively never expires, for the legacy static
// MCP_ACCESS_TOKEN path below — requireBearerAuth (the SDK's own middleware)
// hard-rejects any token with no numeric expiresAt, so this path needs one
// even though the underlying credential is a long-lived env var, not
// something this app tracks an expiry for.
const FAR_FUTURE_EXPIRY_SECONDS = Math.floor(Date.now() / 1000) + 100 * 365 * 24 * 60 * 60;

const clientsStore: OAuthRegisteredClientsStore = {
  async getClient(clientId) {
    const doc = await OAuthClient.findOne({ clientId }).lean();
    return doc ? (doc.data as OAuthClientInformationFull) : undefined;
  },

  // Dynamic Client Registration (RFC 7591) — this is deliberately open to any
  // caller with no prior credential, which is normal for DCR: neither Claude
  // nor ChatGPT has a secret to present before they have ever talked to this
  // server. Registering a client_id grants no access on its own — the actual
  // security boundary is the app password gate in authorize() below.
  async registerClient(client) {
    // The framework fills in client_id/client_id_issued_at before calling
    // this, but the type only guarantees the metadata fields at this point —
    // narrow it the same way the framework's own register handler does.
    const full = client as OAuthClientInformationFull;
    await OAuthClient.create({ clientId: full.client_id, data: full });
    return full;
  },
};

export const oauthServerProvider: OAuthServerProvider = {
  clientsStore,

  // Called once per browser visit to /authorize. The SDK's authorization
  // handler has already validated client_id and redirect_uri before this
  // runs; everything past that — showing the password form, checking it, and
  // issuing the code — is this app's own job. res.req carries the original
  // request, which is how a GET (first visit) is told apart from a POST (the
  // form's own submission back to this same endpoint).
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
    const req = res.req;
    const hidden = {
      client_id: client.client_id,
      redirect_uri: params.redirectUri,
      response_type: "code",
      code_challenge: params.codeChallenge,
      code_challenge_method: "S256",
      scope: params.scopes?.join(" "),
      state: params.state,
    };
    const clientName = client.client_name ?? "An application";

    const showForm = (error?: string) => {
      // Hardcoded rather than taken from req.originalUrl: the SDK's own
      // metadata builder fixes authorization_endpoint at "/authorize" and
      // does not expose a way to change it, and req.originalUrl on the
      // initial GET would carry the whole query string into the form's
      // action, which the POST handler ignores anyway (it reads only
      // req.body) but is needless noise in the markup.
      res.set("Content-Type", "text/html; charset=utf-8");
      res.status(error ? 401 : 200).send(renderLoginPage({ clientName, action: "/authorize", hidden, error }));
    };

    const submittedPassword = req.method === "POST" ? (req.body as { password?: string })?.password : undefined;
    if (submittedPassword === undefined) {
      showForm();
      return;
    }

    if (!constantTimeEquals(submittedPassword, process.env.APP_PASSWORD ?? "")) {
      showForm("That password doesn't match. Try again.");
      return;
    }

    const code = generateToken();
    await OAuthAuthorizationCode.create({
      codeHash: hashToken(code),
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      scope: params.scopes?.join(" ") ?? "",
      expiresAt: new Date(Date.now() + AUTHORIZATION_CODE_TTL_MS),
    });

    const redirectUrl = new URL(params.redirectUri);
    redirectUrl.searchParams.set("code", code);
    if (params.state) redirectUrl.searchParams.set("state", params.state);
    res.redirect(302, redirectUrl.toString());
  },

  // The SDK's token handler calls this first and performs the actual PKCE
  // comparison itself (see @modelcontextprotocol/sdk's token handler) — this
  // only has to hand back what challenge was recorded, or say the code is
  // dead. It does not consume the code; exchangeAuthorizationCode does that
  // only after PKCE has already passed.
  async challengeForAuthorizationCode(client, authorizationCode) {
    const doc = await OAuthAuthorizationCode.findOne({
      codeHash: hashToken(authorizationCode),
      clientId: client.client_id,
    }).lean();
    if (!doc || doc.expiresAt.getTime() < Date.now()) {
      throw new InvalidGrantError("Authorization code is invalid or has expired");
    }
    return doc.codeChallenge;
  },

  // Only reached once the SDK has confirmed the caller's code_verifier
  // actually matches the challenge above, so this just has to re-check the
  // things PKCE doesn't cover — the code still exists, still belongs to this
  // client, and (when the token request specifies one) the redirect_uri
  // matches what was authorized — then consume it exactly once.
  async exchangeAuthorizationCode(client, authorizationCode, _codeVerifier, redirectUri) {
    const codeHash = hashToken(authorizationCode);
    const doc = await OAuthAuthorizationCode.findOneAndDelete({ codeHash, clientId: client.client_id });
    if (!doc || doc.expiresAt.getTime() < Date.now()) {
      throw new InvalidGrantError("Authorization code is invalid or has expired");
    }
    if (redirectUri && redirectUri !== doc.redirectUri) {
      throw new InvalidGrantError("redirect_uri does not match the one used to request this code");
    }

    return issueTokenPair(client.client_id, doc.scope);
  },

  // Refresh tokens rotate: the one presented here is deleted the moment it is
  // read, whether or not the request turns out valid, so it can never be
  // replayed even if this call fails downstream after the delete.
  async exchangeRefreshToken(client, refreshToken, scopes) {
    const tokenHash = hashToken(refreshToken);
    const doc = await OAuthRefreshToken.findOneAndDelete({ tokenHash, clientId: client.client_id });
    if (!doc || doc.expiresAt.getTime() < Date.now()) {
      throw new InvalidGrantError("Refresh token is invalid or has expired");
    }
    return issueTokenPair(client.client_id, scopes?.join(" ") ?? doc.scope);
  },

  // Reads process.env.MCP_ACCESS_TOKEN fresh on every call rather than
  // capturing it once — matching the existing rule in this codebase (see
  // health-events routes) that a bearer check must observe an env var
  // rotated after the process started, not just at boot.
  async verifyAccessToken(token): Promise<AuthInfo> {
    const staticToken = process.env.MCP_ACCESS_TOKEN ?? "";
    if (staticToken && constantTimeEquals(token, staticToken)) {
      return { token, clientId: "static-bearer-token", scopes: ["mcp"], expiresAt: FAR_FUTURE_EXPIRY_SECONDS };
    }

    const doc = await OAuthAccessToken.findOne({ tokenHash: hashToken(token) }).lean();
    if (!doc || doc.expiresAt.getTime() < Date.now()) {
      throw new InvalidTokenError("Access token is invalid or has expired");
    }
    return {
      token,
      clientId: doc.clientId,
      scopes: doc.scope ? doc.scope.split(" ") : ["mcp"],
      expiresAt: Math.floor(doc.expiresAt.getTime() / 1000),
    };
  },
};

async function issueTokenPair(clientId: string, scope: string): Promise<OAuthTokens> {
  const accessToken = generateToken();
  const refreshToken = generateToken();

  await Promise.all([
    OAuthAccessToken.create({
      tokenHash: hashToken(accessToken),
      clientId,
      scope,
      expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000),
    }),
    OAuthRefreshToken.create({
      tokenHash: hashToken(refreshToken),
      clientId,
      scope,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    }),
  ]);

  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope,
  };
}
