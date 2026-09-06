import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../app.js";
import { CoachNote } from "../models/CoachNote.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.disconnect();
  }
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  process.env.MCP_ACCESS_TOKEN = "test-mcp-token";
});

afterEach(async () => {
  await CoachNote.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

// The stateless Streamable HTTP transport answers a POST with an SSE stream,
// so the JSON-RPC payload arrives on a `data:` line rather than as the body.
function parseSseResult(text: string) {
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  if (!line) throw new Error(`No SSE data line in response: ${JSON.stringify(text)}`);
  return JSON.parse(line.slice("data:".length).trim());
}

function mcpRequest(app: ReturnType<typeof createApp>) {
  return request(app)
    .post("/mcp")
    .set("Accept", "application/json, text/event-stream")
    .set("Content-Type", "application/json");
}

describe("POST /mcp", () => {
  it("rejects a request with no Authorization header", async () => {
    const res = await mcpRequest(createApp()).send({ jsonrpc: "2.0", id: 1, method: "tools/list" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  it("rejects a request with the wrong bearer token", async () => {
    const res = await mcpRequest(createApp())
      .set("Authorization", "Bearer not-the-token")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });

    expect(res.status).toBe(401);
  });

  it("reads MCP_ACCESS_TOKEN per request, not once at mount time", async () => {
    const app = createApp();
    process.env.MCP_ACCESS_TOKEN = "rotated-after-mount";
    try {
      const rejected = await mcpRequest(app)
        .set("Authorization", "Bearer test-mcp-token")
        .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
      expect(rejected.status).toBe(401);

      const accepted = await mcpRequest(app)
        .set("Authorization", "Bearer rotated-after-mount")
        .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
      expect(accepted.status).toBe(200);
    } finally {
      process.env.MCP_ACCESS_TOKEN = "test-mcp-token";
    }
  });

  it("lists the registered tools for an authenticated request", async () => {
    const res = await mcpRequest(createApp())
      .set("Authorization", "Bearer test-mcp-token")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });

    expect(res.status).toBe(200);

    const payload = parseSseResult(res.text);
    expect(payload.error).toBeUndefined();
    const toolNames = payload.result.tools.map((tool: { name: string }) => tool.name);
    expect(toolNames).toEqual(
      expect.arrayContaining(["get_weekly_digest", "get_nutrition_summary", "save_coach_note"])
    );
  });

  it("runs save_coach_note end-to-end and persists the note", async () => {
    const res = await mcpRequest(createApp())
      .set("Authorization", "Bearer test-mcp-token")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "save_coach_note",
          arguments: {
            weekOf: "2026-09-01",
            summary: "Solid week of training.",
            suggestions: ["Add one more walk"],
            source: "mcp_session",
          },
        },
      });

    expect(res.status).toBe(200);

    const payload = parseSseResult(res.text);
    expect(payload.error).toBeUndefined();
    expect(payload.result.isError).toBeFalsy();

    const notes = await CoachNote.find({});
    expect(notes).toHaveLength(1);
    expect(notes[0].weekOf).toBe("2026-09-01");
    expect(notes[0].summary).toBe("Solid week of training.");
    expect(notes[0].source).toBe("mcp_session");
  });
});
