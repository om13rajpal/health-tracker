import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import mongoose from "mongoose";
import { jsonErrorHandler } from "./errorHandler.js";
import { createApp } from "../app.js";

function testApp() {
  const app = express();
  app.use(express.json());

  app.post("/throws-generic", () => {
    throw new Error("something broke");
  });

  app.post("/throws-validation", () => {
    const err = new mongoose.Error.ValidationError();
    throw err;
  });

  app.post("/ok", (_req, res) => {
    res.json({ ok: true });
  });

  app.use(jsonErrorHandler);
  return app;
}

describe("jsonErrorHandler", () => {
  it("returns 400 JSON (not an HTML page) for a malformed JSON body", async () => {
    const res = await request(testApp())
      .post("/ok")
      .set("Content-Type", "application/json")
      .send('{"not valid json"');

    expect(res.status).toBe(400);
    expect(res.type).toBe("application/json");
    expect(res.body.error).toBeDefined();
  });

  it("returns 400 JSON for a Mongoose ValidationError", async () => {
    const res = await request(testApp()).post("/throws-validation").send({});
    expect(res.status).toBe(400);
    expect(res.type).toBe("application/json");
  });

  it("returns 500 JSON for an unrecognized error, without leaking the stack trace", async () => {
    const res = await request(testApp()).post("/throws-generic").send({});
    expect(res.status).toBe(500);
    expect(res.type).toBe("application/json");
    expect(res.body.error).toBe("Internal server error");
    expect(JSON.stringify(res.body)).not.toContain("at ");
  });

  it("does not interfere with a successful request", async () => {
    const res = await request(testApp()).post("/ok").send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("is wired into the real app, after every router and the MCP mount", async () => {
    // A too-short secret makes getSession() throw inside the logout handler.
    // Express 5 forwards the rejection down the stack, so a JSON 500 here
    // proves the handler is mounted last in the real app, not just that the
    // function works in isolation.
    const previousSecret = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "too-short";
    try {
      const res = await request(createApp()).post("/api/auth/logout").send({});

      expect(res.status).toBe(500);
      expect(res.type).toBe("application/json");
      expect(res.body.error).toBe("Internal server error");
      expect(JSON.stringify(res.body)).not.toContain("at ");
    } finally {
      // Assigning `undefined` to a process.env property stringifies it to
      // "undefined" rather than deleting the key — delete explicitly so a
      // previously-unset SESSION_SECRET doesn't leak a bogus value forward.
      if (previousSecret === undefined) {
        delete process.env.SESSION_SECRET;
      } else {
        process.env.SESSION_SECRET = previousSecret;
      }
    }
  });
});
