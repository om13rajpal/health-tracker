import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { requireBearerToken } from "./bearerAuth.js";

function testApp(expectedToken: string) {
  const app = express();
  app.get("/protected", requireBearerToken(expectedToken), (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe("requireBearerToken", () => {
  it("rejects a request with no Authorization header", async () => {
    const res = await request(testApp("secret-token")).get("/protected");
    expect(res.status).toBe(401);
  });

  it("rejects a request with the wrong token", async () => {
    const res = await request(testApp("secret-token")).get("/protected").set("Authorization", "Bearer wrong");
    expect(res.status).toBe(401);
  });

  it("rejects a header that isn't in Bearer form", async () => {
    const res = await request(testApp("secret-token")).get("/protected").set("Authorization", "secret-token");
    expect(res.status).toBe(401);
  });

  it("allows a request with the correct bearer token", async () => {
    const res = await request(testApp("secret-token")).get("/protected").set("Authorization", "Bearer secret-token");
    expect(res.status).toBe(200);
  });
});
