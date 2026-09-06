import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { connectDb, disconnectDb } from "./db.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
});

afterAll(async () => {
  await mongod.stop();
});

describe("connectDb", () => {
  it("connects to the given MongoDB URI", async () => {
    await connectDb(mongod.getUri());
    expect(mongoose.connection.readyState).toBe(1);
    await disconnectDb();
  });
});
