import { apiFetch } from "./apiFetch";
import { db, type OutboxItemType } from "./db";

const ENDPOINT_BY_TYPE: Record<OutboxItemType, string> = {
  workout: "/api/workouts",
  nutrition: "/api/nutrition/entries",
  sleep: "/api/sleep",
};

export async function queueForSync(type: OutboxItemType, payload: unknown): Promise<number> {
  return db.outbox.add({
    type,
    payload,
    createdAt: Date.now(),
    status: "pending",
  } as never);
}

// 4xx statuses that a later retry can still resolve without the payload
// changing: the session can be renewed, a timeout or rate-limit passes.
// Every other 4xx is the server rejecting this payload, permanently.
const RETRYABLE_CLIENT_ERRORS = new Set([401, 403, 408, 429]);

function isPermanentRejection(status: number): boolean {
  return status >= 400 && status < 500 && !RETRYABLE_CLIENT_ERRORS.has(status);
}

let syncInProgress = false;

export async function syncOutbox(): Promise<{ synced: number; failed: number; invalid: number }> {
  if (syncInProgress) {
    return { synced: 0, failed: 0, invalid: 0 };
  }
  syncInProgress = true;

  try {
    const pending = await db.outbox.where("status").anyOf("pending", "failed").toArray();

    let synced = 0;
    let failed = 0;
    let invalid = 0;

    for (const item of pending) {
      await db.outbox.update(item.id, { status: "syncing" });
      try {
        const res = await apiFetch(ENDPOINT_BY_TYPE[item.type], {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item.payload),
        });
        if (res.status >= 200 && res.status < 300) {
          await db.outbox.update(item.id, { status: "synced" });
          synced += 1;
        } else if (isPermanentRejection(res.status)) {
          // The server rejected the payload itself (schema violation, bad
          // reference). Retrying it every 30s for the life of the install
          // would never succeed, so park it in a terminal state the
          // pending/failed query won't pick up again.
          await db.outbox.update(item.id, { status: "invalid" });
          invalid += 1;
        } else {
          await db.outbox.update(item.id, { status: "failed" });
          failed += 1;
        }
      } catch {
        // Network error (offline, DNS failure, etc.) — never drop the item.
        await db.outbox.update(item.id, { status: "failed" });
        failed += 1;
      }
    }

    return { synced, failed, invalid };
  } finally {
    syncInProgress = false;
  }
}
