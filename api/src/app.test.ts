import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";

describe("createApp", () => {
  it("responds to GET /health with status ok", async () => {
    const app = createApp();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("answers an unknown path with JSON 404, not Express's default HTML page", async () => {
    const res = await request(createApp()).get("/api/does-not-exist");

    expect(res.status).toBe(404);
    expect(res.type).toBe("application/json");
    expect(res.body).toEqual({ error: "Not found" });
  });
});
