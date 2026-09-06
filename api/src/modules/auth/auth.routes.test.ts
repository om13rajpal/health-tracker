import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";

describe("auth routes", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = "a".repeat(32);
    process.env.APP_PASSWORD = "correct-horse-battery-staple";
  });

  it("rejects a login with the wrong password", async () => {
    const app = createApp();
    const res = await request(app).post("/api/auth/login").send({ password: "wrong" });
    expect(res.status).toBe(401);
  });

  it("logs in with the correct password and sets a session cookie", async () => {
    const app = createApp();
    const res = await request(app).post("/api/auth/login").send({ password: "correct-horse-battery-staple" });
    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("issues a cross-site-capable cookie in production", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const app = createApp();
      const res = await request(app).post("/api/auth/login").send({ password: "correct-horse-battery-staple" });
      const cookie = (res.headers["set-cookie"] as unknown as string[])[0];
      // Vercel web -> Render api is cross-site; Lax would withhold the cookie.
      expect(cookie).toMatch(/SameSite=None/i);
      expect(cookie).toMatch(/Secure/i);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it("keeps a lax, non-secure cookie in local dev so http://localhost works", async () => {
    const app = createApp();
    const res = await request(app).post("/api/auth/login").send({ password: "correct-horse-battery-staple" });
    const cookie = (res.headers["set-cookie"] as unknown as string[])[0];
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toMatch(/Secure/i);
  });

  it("blocks a protected route without a session", async () => {
    const app = createApp();
    const res = await request(app).get("/api/auth/whoami");
    expect(res.status).toBe(401);
  });

  it("allows a protected route after logging in", async () => {
    const app = createApp();
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ password: "correct-horse-battery-staple" });
    const res = await agent.get("/api/auth/whoami");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ loggedIn: true });
  });
});
