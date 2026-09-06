import Dexie, { type EntityTable } from "dexie";

export type OutboxItemType = "workout" | "nutrition" | "sleep";
// "failed" is retryable (5xx, offline); "invalid" is terminal — the server
// rejected the payload itself, so no number of retries will change the answer.
export type OutboxStatus = "pending" | "syncing" | "synced" | "failed" | "invalid";

export type OutboxItem = {
  id: number;
  type: OutboxItemType;
  payload: unknown;
  createdAt: number;
  status: OutboxStatus;
};

export const db = new Dexie("health-tracker") as Dexie & {
  outbox: EntityTable<OutboxItem, "id">;
};

db.version(1).stores({
  outbox: "++id, type, status, createdAt",
});
