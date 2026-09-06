import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createHash, randomBytes } from "node:crypto";
import { createApp } from "../../app.js";
import { OAuthClient } from "../../models/OAuthClient.js";
import { OAuthAuthorizationCode } from "../../models/OAuthAuthorizationCode.js";
import { OAuthAccessToken } from "../../models/OAuthAccessToken.js";
import { OAuthRefreshToken } from "../../models/OAuthRefreshToken.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.disconnect();
  }
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  process.env.APP_PASSWORD = "test-app-password";
  process.env.MCP_ACCESS_TOKEN = "test-mcp-token";
});

afterEach(async () => {
  await Promise.all([
    OAuthClient.deleteMany({}),
    OAuthAuthorizationCode.deleteMany({}),
    OAuthAccessToken.deleteMany({}),
    OAuthRefreshToken.deleteMany({}),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

// RFC 7636 §4.1-4.2, hand-rolled rather than pulled in as a dependency for
// one test file — a verifier is 43-128 unreserved characters and the
// challenge is BASE64URL(SHA256(verifier)) with no padding.
function makePkcePair() {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function registerClient(app: ReturnType<typeof createApp>, redirectUri = "https://client.example.com/callback") {
  const res = await request(app)
    .post("/register")
    .send({ redirect_uris: [redirectUri], client_name: "Test Client", token_endpoint_auth_method: "none" });
  expect(res.status).toBe(201);
  expect(res.body.client_secret).toBeUndefined();
  return res.body as { client_id: string; redirect_uris: string[] };
}

describe("OAuth discovery metadata", () => {
  it("serves RFC 8414 authorization server metadata", async () => {
    const res = await request(createApp()).get("/.well-known/oauth-authorization-server");
    expect(res.status).toBe(200);
    expect(res.body.authorization_endpoint).toMatch(/\/authorize$/);
    expect(res.body.token_endpoint).toMatch(/\/token$/);
    expect(res.body.registration_endpoint).toMatch(/\/register$/);
    expect(res.body.code_challenge_methods_supported).toContain("S256");
  });

  it("serves RFC 9728 protected resource metadata for /mcp", async () => {
    const res = await request(createApp()).get("/.well-known/oauth-protected-resource/mcp");
    expect(res.status).toBe(200);
    expect(res.body.resource).toMatch(/\/mcp$/);
    expect(Array.isArray(res.body.authorization_servers)).toBe(true);
  });
});

describe("POST /register (dynamic client registration)", () => {
  it("registers a public client with no secret", async () => {
    const app = createApp();
    const client = await registerClient(app);
    expect(client.client_id).toBeTruthy();
    expect(client.redirect_uris).toEqual(["https://client.example.com/callback"]);
  });

  it("rejects registration with no redirect_uris", async () => {
    const res = await request(createApp()).post("/register").send({});
    expect(res.status).toBe(400);
  });
});

describe("GET /authorize", () => {
  it("renders a password form for a registered client", async () => {
    const app = createApp();
    const client = await registerClient(app);
    const { challenge } = makePkcePair();

    const res = await request(app).get("/authorize").query({
      client_id: client.client_id,
      redirect_uri: client.redirect_uris[0],
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "xyz",
    });

    expect(res.status).toBe(200);
    expect(res.text).toContain("<form");
    expect(res.text).toContain(client.client_id);
  });

  it("rejects an unregistered redirect_uri before ever showing the form", async () => {
    const app = createApp();
    const client = await registerClient(app);
    const { challenge } = makePkcePair();

    const res = await request(app).get("/authorize").query({
      client_id: client.client_id,
      redirect_uri: "https://not-the-registered-one.example.com/callback",
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
    });

    expect(res.status).toBe(400);
  });
});

describe("POST /authorize", () => {
  it("re-shows the form on a wrong password without issuing a code", async () => {
    const app = createApp();
    const client = await registerClient(app);
    const { challenge } = makePkcePair();

    const res = await request(app)
      .post("/authorize")
      .type("form")
      .send({
        client_id: client.client_id,
        redirect_uri: client.redirect_uris[0],
        response_type: "code",
        code_challenge: challenge,
        code_challenge_method: "S256",
        password: "wrong-password",
      });

    expect(res.status).toBe(401);
    expect(res.text).toContain("doesn&#39;t match");
    expect(await OAuthAuthorizationCode.countDocuments({})).toBe(0);
  });

  it("issues a code and redirects to redirect_uri on the correct password", async () => {
    const app = createApp();
    const client = await registerClient(app);
    const { challenge } = makePkcePair();

    const res = await request(app)
      .post("/authorize")
      .type("form")
      .send({
        client_id: client.client_id,
        redirect_uri: client.redirect_uris[0],
        response_type: "code",
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: "preserve-me",
        password: "test-app-password",
      });

    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    expect(location.origin + location.pathname).toBe(client.redirect_uris[0]);
    expect(location.searchParams.get("code")).toBeTruthy();
    expect(location.searchParams.get("state")).toBe("preserve-me");
  });
});

describe("POST /token", () => {
  async function getAuthorizedCode(app: ReturnType<typeof createApp>) {
    const client = await registerClient(app);
    const { verifier, challenge } = makePkcePair();
    const authRes = await request(app)
      .post("/authorize")
      .type("form")
      .send({
        client_id: client.client_id,
        redirect_uri: client.redirect_uris[0],
        response_type: "code",
        code_challenge: challenge,
        code_challenge_method: "S256",
        password: "test-app-password",
      });
    const code = new URL(authRes.headers.location).searchParams.get("code")!;
    return { client, code, verifier };
  }

  it("exchanges a valid code + verifier for an access and refresh token", async () => {
    const app = createApp();
    const { client, code, verifier } = await getAuthorizedCode(app);

    const res = await request(app).post("/token").type("form").send({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: client.client_id,
      redirect_uri: client.redirect_uris[0],
    });

    expect(res.status).toBe(200);
    expect(res.body.token_type).toBe("Bearer");
    expect(res.body.access_token).toBeTruthy();
    expect(res.body.refresh_token).toBeTruthy();
    expect(res.body.expires_in).toBeGreaterThan(0);
  });

  it("rejects a code reused a second time — single use", async () => {
    const app = createApp();
    const { client, code, verifier } = await getAuthorizedCode(app);
    const body = {
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: client.client_id,
      redirect_uri: client.redirect_uris[0],
    };

    const first = await request(app).post("/token").type("form").send(body);
    expect(first.status).toBe(200);

    const second = await request(app).post("/token").type("form").send(body);
    expect(second.status).toBe(400);
    expect(second.body.error).toBe("invalid_grant");
  });

  it("rejects a mismatched code_verifier", async () => {
    const app = createApp();
    const { client, code } = await getAuthorizedCode(app);

    const res = await request(app)
      .post("/token")
      .type("form")
      .send({
        grant_type: "authorization_code",
        code,
        code_verifier: "the-wrong-verifier-entirely-00000000000000000",
        client_id: client.client_id,
        redirect_uri: client.redirect_uris[0],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_grant");
  });

  it("rotates the refresh token: the old one dies the moment a new pair is issued", async () => {
    const app = createApp();
    const { client, code, verifier } = await getAuthorizedCode(app);
    const first = await request(app).post("/token").type("form").send({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: client.client_id,
      redirect_uri: client.redirect_uris[0],
    });
    const oldRefreshToken = first.body.refresh_token as string;

    const refreshed = await request(app)
      .post("/token")
      .type("form")
      .send({ grant_type: "refresh_token", refresh_token: oldRefreshToken, client_id: client.client_id });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.access_token).not.toBe(first.body.access_token);

    const replay = await request(app)
      .post("/token")
      .type("form")
      .send({ grant_type: "refresh_token", refresh_token: oldRefreshToken, client_id: client.client_id });
    expect(replay.status).toBe(400);
    expect(replay.body.error).toBe("invalid_grant");
  });
});

describe("OAuth access token authenticates against /mcp", () => {
  it("lets a freshly minted access token call an MCP tool", async () => {
    const app = createApp();
    const client = await registerClient(app);
    const { verifier, challenge } = makePkcePair();

    const authRes = await request(app)
      .post("/authorize")
      .type("form")
      .send({
        client_id: client.client_id,
        redirect_uri: client.redirect_uris[0],
        response_type: "code",
        code_challenge: challenge,
        code_challenge_method: "S256",
        password: "test-app-password",
      });
    const code = new URL(authRes.headers.location).searchParams.get("code")!;

    const tokenRes = await request(app).post("/token").type("form").send({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: client.client_id,
      redirect_uri: client.redirect_uris[0],
    });

    const mcpRes = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${tokenRes.body.access_token}`)
      .set("Accept", "application/json, text/event-stream")
      .set("Content-Type", "application/json")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });

    expect(mcpRes.status).toBe(200);
  });

  it("still accepts the legacy static MCP_ACCESS_TOKEN alongside real OAuth tokens", async () => {
    const res = await request(createApp())
      .post("/mcp")
      .set("Authorization", "Bearer test-mcp-token")
      .set("Accept", "application/json, text/event-stream")
      .set("Content-Type", "application/json")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });

    expect(res.status).toBe(200);
  });

  it("rejects a 401 with a WWW-Authenticate header pointing at protected-resource metadata", async () => {
    const res = await request(createApp())
      .post("/mcp")
      .set("Accept", "application/json, text/event-stream")
      .set("Content-Type", "application/json")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });

    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toContain("resource_metadata=");
  });
});
