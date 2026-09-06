import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { db } from "./db";
import { queueForSync, syncOutbox } from "./outbox";

beforeEach(async () => {
  await db.outbox.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("queueForSync", () => {
  it("writes an item to the outbox with status pending", async () => {
    const id = await queueForSync("workout", { date: "2026-09-06" });
    const item = await db.outbox.get(id);
    expect(item?.status).toBe("pending");
    expect(item?.type).toBe("workout");
    expect(item?.payload).toEqual({ date: "2026-09-06" });
  });
});

describe("syncOutbox", () => {
  it("marks an item synced when the POST succeeds", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 201 })));
    const id = await queueForSync("workout", { date: "2026-09-06" });

    const result = await syncOutbox();

    expect(result).toEqual({ synced: 1, failed: 0, invalid: 0 });
    const item = await db.outbox.get(id);
    expect(item?.status).toBe("synced");
  });

  it("marks an item failed (not synced, not lost) when the POST fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
    const id = await queueForSync("workout", { date: "2026-09-06" });

    const result = await syncOutbox();

    expect(result).toEqual({ synced: 0, failed: 1, invalid: 0 });
    const item = await db.outbox.get(id);
    expect(item?.status).toBe("failed");
    expect(item?.payload).toEqual({ date: "2026-09-06" }); // the data survives, ready to retry
  });

  it("marks an item failed when the network throws (offline), never drops it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const id = await queueForSync("nutrition", { date: "2026-09-06" });

    const result = await syncOutbox();

    expect(result).toEqual({ synced: 0, failed: 1, invalid: 0 });
    const item = await db.outbox.get(id);
    expect(item?.status).toBe("failed");
  });

  it("retries a previously-failed item on the next sync call", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
    const id = await queueForSync("workout", { date: "2026-09-06" });
    await syncOutbox();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 201 })));
    const result = await syncOutbox();

    expect(result).toEqual({ synced: 1, failed: 0, invalid: 0 });
    const item = await db.outbox.get(id);
    expect(item?.status).toBe("synced");
  });

  it("parks a 400-rejected item as invalid and never retries it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const id = await queueForSync("workout", { date: "not-a-date" });

    const first = await syncOutbox();

    expect(first).toEqual({ synced: 0, failed: 0, invalid: 1 });
    expect(await db.outbox.get(id)).toMatchObject({ status: "invalid" });

    // A second pass must not pick it back up — otherwise this is a permanent
    // 30-second POST loop for a payload that can never succeed.
    const second = await syncOutbox();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual({ synced: 0, failed: 0, invalid: 0 });
    expect(await db.outbox.get(id)).toMatchObject({ status: "invalid" });
  });

  it("keeps a 500-rejected item retryable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const id = await queueForSync("workout", { date: "2026-09-06" });

    await syncOutbox();
    expect(await db.outbox.get(id)).toMatchObject({ status: "failed" });

    await syncOutbox();

    expect(fetchMock).toHaveBeenCalledTimes(2); // retried, unlike the 400
  });

  it("keeps a 401-rejected item retryable, since re-logging in can still save it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
    const id = await queueForSync("nutrition", { date: "2026-09-06" });

    const result = await syncOutbox();

    expect(result).toEqual({ synced: 0, failed: 1, invalid: 0 });
    expect(await db.outbox.get(id)).toMatchObject({ status: "failed" });
  });

  it("does not double-submit an item when syncOutbox is called concurrently", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const id = await queueForSync("workout", { date: "2026-09-06" });

    const [first, second] = await Promise.all([syncOutbox(), syncOutbox()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.synced + second.synced).toBe(1);
    const item = await db.outbox.get(id);
    expect(item?.status).toBe("synced");
  });

  it("routes each outbox type to its correct endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await queueForSync("workout", { a: 1 });
    await queueForSync("nutrition", { b: 2 });
    await queueForSync("sleep", { c: 3 });
    await syncOutbox();

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/workouts"), expect.anything());
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/nutrition/entries"), expect.anything());
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/sleep"), expect.anything());
  });
});
