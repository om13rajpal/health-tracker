"use client";

import { PageHeader } from "../components/ui";

/** The last line of defence: something threw where no page handled it. It says
 *  the one thing that matters here — nothing logged on this device is gone,
 *  because the outbox holds it until it syncs. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <>
      <PageHeader title="Something broke" blurb="This screen failed to render. Your record is untouched." />
      <main className="measure py-8">
        <p className="t-body">
          Nothing logged on this device has been lost — anything waiting to sync is still queued and will go up on
          its own.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={reset} className="btn btn-primary">
            Try again
          </button>
          <a href="/" className="btn btn-secondary">
            Back to Today
          </a>
        </div>
        {error.digest && (
          <p className="t-caption mt-6">
            Reference <span className="t-num">{error.digest}</span>
          </p>
        )}
      </main>
    </>
  );
}
