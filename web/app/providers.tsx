"use client";

import { QueryClient, QueryClientProvider, useIsRestoring } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { useState } from "react";
import { useOutboxSync } from "../lib/useOutbox";

// Bumped whenever a persisted query's shape changes incompatibly (a renamed
// field, a different response type). A stale cache would otherwise render
// with fields the current code no longer expects instead of just refetching.
const PERSIST_BUSTER = "v1";
const MAX_PERSIST_AGE_MS = 24 * 60 * 60 * 1000;

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // The record changes only when this person logs something, and the
        // outbox invalidates these queries the moment a write lands. Without a
        // stale time every remount refetched the full twelve weeks, which on a
        // cold-starting free-tier API is a visible wait for data that had not
        // changed.
        staleTime: 60_000,
        gcTime: MAX_PERSIST_AGE_MS,
        // Refetching on every tab focus is the same waste with a worse trigger:
        // the stale time above already covers genuinely old data.
        refetchOnWindowFocus: false,
        // One retry covers a dropped request; more just delays the error state
        // on a page the user is watching.
        retry: 1,
      },
    },
  });
}

/** Lives inside the provider because it needs the query client to invalidate
 *  after a sync. */
function OutboxSync() {
  useOutboxSync();
  return null;
}

/** Holds every page's data-fetching hooks unmounted until the persisted cache
 *  has actually been read back into the client.
 *
 *  PersistQueryClientProvider advertises automatic isRestoring gating for
 *  useQuery, but it did not hold up under test here: on a page whose staleTime
 *  had elapsed since the last visit — the exact case this cache exists for —
 *  every query mounted, fetched, and failed against the (deliberately, for the
 *  test) unreachable API before restoration finished, landing in an error
 *  state with no data. A failed query in that state is excluded from the next
 *  save (the persist client only ever serialises `status === "success"`
 *  queries), so the very query meant to survive the outage overwrote the good
 *  data it was restoring with nothing at all. Gating render on this hook
 *  removes the race outright rather than trying to win it. */
function WaitForRestore({ children }: { children: React.ReactNode }) {
  const isRestoring = useIsRestoring();
  return isRestoring ? null : <>{children}</>;
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(makeQueryClient);
  // Deferred to first render, not module scope: localStorage does not exist
  // during Next's server-side render pass, and touching it there would crash
  // the page rather than just skip persistence.
  const [persister] = useState(() =>
    typeof window === "undefined"
      ? undefined
      : createSyncStoragePersister({ storage: window.localStorage, key: "ledger-query-cache" })
  );

  // The free-tier API sleeps after fifteen minutes idle and takes some fifty
  // seconds to wake, so a returning visitor would otherwise stare at loading
  // skeletons for that whole window on every cold start. Restoring last
  // night's numbers from localStorage first, then refetching underneath, means
  // there is always something on screen — stale by minutes, never blank.
  // This persists reads only. Writes still go through the Dexie outbox
  // exclusively, per this app's existing rule that the two mechanisms for
  // durable local state are never mixed.
  //
  // During SSR (and the very first client render, before hydration) there is
  // no localStorage and so no persister — but every hook here still needs a
  // client in scope, hence a plain QueryClientProvider rather than rendering
  // OutboxSync with nothing above it in the tree at all.
  if (!persister) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{
        persister,
        maxAge: MAX_PERSIST_AGE_MS,
        buster: PERSIST_BUSTER,
        dehydrateOptions: {
          // The default only keeps queries whose *last* fetch succeeded. That
          // is wrong for exactly the case this cache exists for: a query that
          // loaded fine yesterday and then failed a background refetch today
          // (because the free-tier API is asleep) still has yesterday's good
          // `data` sitting in it, and the default would drop it from the very
          // next save — so a second offline visit would restore nothing.
          // Keeping anything with data, error or not, is what actually
          // survives repeated offline visits rather than only the first one.
          shouldDehydrateQuery: (query) => query.state.data !== undefined,
        },
      }}
    >
      <WaitForRestore>
        <OutboxSync />
        {children}
      </WaitForRestore>
    </PersistQueryClientProvider>
  );
}
