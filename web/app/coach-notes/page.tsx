"use client";

import { EmptyState, ErrorState, Loading, PageHeader, Section } from "../../components/ui";
import { DOMAINS } from "../../lib/domains";
import { weekDate } from "../../lib/format";
import { useCoachNotes } from "../../lib/useLedger";

const SOURCE_LABEL: Record<string, string> = {
  mcp_session: "Written in a coaching session",
  vendor_scheduled_task: "Written by the weekly review",
};

export default function CoachNotesPage() {
  const notes = useCoachNotes();

  return (
    <>
      <PageHeader
        title="Coach"
        domain="body"
        blurb="One note a week, written against what the ledger actually recorded."
        stat={
          notes.data?.length
            ? { value: `${notes.data.length}`, caption: notes.data.length === 1 ? "note so far" : "notes so far" }
            : undefined
        }
      />

      <main className="measure py-8">
        <Section title="Weekly notes">
          {notes.isLoading ? (
            <Loading rows={3} label="Loading coach notes" />
          ) : notes.isError ? (
            <ErrorState what="Your coach notes didn't load." onRetry={() => void notes.refetch()} />
          ) : notes.data?.length ? (
            <ol className="flex flex-col gap-2.5">
              {notes.data.map((note, i) => (
                <li key={`${note.weekOf}-${i}`} className="row" style={{ ["--domain" as string]: DOMAINS.body.color }}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                    <h3 className="t-h3" style={{ fontSize: "var(--t-lead)" }}>
                      Week of {weekDate(note.weekOf)}
                    </h3>
                    <p className="t-caption">
                      {SOURCE_LABEL[note.source] ?? note.source}
                      {note.llmModel ? ` with ${note.llmModel}` : ""}
                    </p>
                  </div>

                  <p className="t-body mt-3">{note.summary}</p>

                  {note.suggestions.length > 0 && (
                    <ul className="ruled mt-4 border-t pt-1">
                      {note.suggestions.map((suggestion, j) => (
                        <li key={j} className="t-small py-2.5" style={{ color: "var(--c-ink-soft)" }}>
                          {suggestion}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState
              headline="No notes yet"
              body="Notes appear here once a coaching session reads the week and writes one back through the MCP server. Nothing to do on this screen."
            />
          )}
        </Section>
      </main>
    </>
  );
}
