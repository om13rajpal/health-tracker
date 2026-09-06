"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db";
import { syncOutbox } from "./outbox";

const RETRY_INTERVAL_MS = 30_000;

export function usePendingOutboxCount(): number {
  return useLiveQuery(() => db.outbox.where("status").anyOf("pending", "failed").count(), [], 0) ?? 0;
}

export function useOutboxSync(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    // A queued write only reaches the server later, so the dashboards are stale
    // from the moment it lands until something refetches. Nothing used to do
    // that: a session logged in the gym stayed invisible on Train until the
    // query happened to be refetched for another reason.
    const syncAndRefresh = async () => {
      try {
        const result = await syncOutbox();
        if ((result?.synced ?? 0) > 0) await queryClient.invalidateQueries();
      } catch {
        // syncOutbox already records each per-item outcome and the interval below
        // retries, so there is nothing to do here — but it must not escape as
        // an unhandled rejection, which would surface as a console error on a
        // page that is otherwise working fine.
      }
    };

    void syncAndRefresh();
    const handleOnline = () => void syncAndRefresh();
    window.addEventListener("online", handleOnline);
    const interval = setInterval(() => void syncAndRefresh(), RETRY_INTERVAL_MS);
    return () => {
      window.removeEventListener("online", handleOnline);
      clearInterval(interval);
    };
  }, [queryClient]);
}
