import Link from "next/link";
import { IconAlert, IconBack } from "./icons";
import { DOMAINS, type DomainKey } from "../lib/domains";

/* -------------------------------------------------------------- page band -- */

type PageHeaderProps = {
  title: string;
  /** One sentence naming the question this page answers. */
  blurb?: string;
  domain?: DomainKey;
  stat?: { value: string; unit?: string; caption: string };
  backTo?: { href: string; label: string };
  children?: React.ReactNode;
};

export function PageHeader({ title, blurb, domain, stat, backTo, children }: PageHeaderProps) {
  // The header sits on the dark band in both themes, so it uses each domain's
  // on-band step rather than its page colour.
  const accent = domain ? DOMAINS[domain].bandColor : "var(--c-on-ink)";

  return (
    <header className="band">
      <div className="measure py-7 sm:py-9">
        {backTo && (
          <Link
            href={backTo.href}
            className="t-small mb-4 inline-flex items-center gap-1.5 no-underline"
            style={{ color: "var(--c-on-ink-soft)" }}
          >
            <IconBack size={16} />
            {backTo.label}
          </Link>
        )}

        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
          <div className="min-w-0">
            <h1 className="t-h1" style={{ color: "var(--c-on-ink)" }}>
              {domain && (
                <span
                  aria-hidden
                  className="mr-3 inline-block h-[0.62em] w-[4px] align-baseline"
                  style={{ background: accent }}
                />
              )}
              {title}
            </h1>
            {blurb && <p className="t-lead mt-2.5 max-w-[46ch]">{blurb}</p>}
          </div>

          {stat && (
            <p className="min-w-0">
              <span className="t-stat block" style={{ fontSize: "clamp(2.5rem, 7vw, 3.5rem)", color: accent }}>
                {stat.value}
                {stat.unit && (
                  <span className="ml-1 align-baseline" style={{ fontSize: "0.42em", fontWeight: 600 }}>
                    {stat.unit}
                  </span>
                )}
              </span>
              <span className="t-caption mt-1.5 block max-w-[30ch]">{stat.caption}</span>
            </p>
          )}
        </div>

        {children && <div className="mt-7">{children}</div>}
      </div>
    </header>
  );
}

/* --------------------------------------------------------------- sections -- */

export function Section({
  title,
  note,
  action,
  children,
}: {
  title: string;
  note?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-9 first:mt-0">
      <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b pb-2">
        <h2 className="t-h3">{title}</h2>
        {action}
      </div>
      {note && <p className="t-small mb-4" style={{ color: "var(--c-ink-soft)", maxWidth: "62ch" }}>{note}</p>}
      {children}
    </section>
  );
}

/** A single reading. Used in rows and grids; never boxed in its own card.
 *  Pass `null` for a reading that does not exist yet — an em-dash set in the
 *  display face at full size reads as a stray rule, not as an absence, so the
 *  empty case is typeset deliberately instead. */
export function Reading({
  value,
  unit,
  label,
  color,
  size = "md",
  emptyLabel = "not recorded",
}: {
  value: string | null;
  unit?: string;
  label: string;
  color?: string;
  size?: "sm" | "md" | "lg";
  emptyLabel?: string;
}) {
  const fontSize = size === "lg" ? "2.25rem" : size === "sm" ? "1.25rem" : "1.75rem";

  if (value === null) {
    return (
      <p>
        <span
          className="block"
          style={{
            fontSize: `calc(${fontSize} * 0.55)`,
            fontWeight: 600,
            lineHeight: 1.25,
            color: "var(--c-ink-faint)",
          }}
        >
          {emptyLabel}
        </span>
        <span className="t-caption mt-1 block">{label}</span>
      </p>
    );
  }

  return (
    <p>
      <span className="t-stat block" style={{ fontSize, color: color ?? "var(--c-ink)" }}>
        {value}
        {unit && (
          <span className="ml-0.5 align-baseline" style={{ fontSize: "0.46em", fontWeight: 600 }}>
            {unit}
          </span>
        )}
      </span>
      <span className="t-caption mt-1 block">{label}</span>
    </p>
  );
}

/* ----------------------------------------------------------------- states -- */

export function Loading({ rows = 3, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2.5">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: i === 0 ? "3.5rem" : "2.75rem" }} />
      ))}
    </div>
  );
}

/** Says what failed and what to do about it, in the app's own voice. */
export function ErrorState({ what, onRetry }: { what: string; onRetry?: () => void }) {
  return (
    <div className="notice notice-bad" role="alert">
      <span style={{ color: "var(--c-bad)" }} className="mt-px flex-none">
        <IconAlert size={18} />
      </span>
      <span>
        {what} Check your connection, then try again — nothing you logged on this device has been lost.
        {onRetry && (
          <button type="button" onClick={onRetry} className="btn btn-quiet ml-2 min-h-0 px-1 underline">
            Retry
          </button>
        )}
      </span>
    </div>
  );
}

/** An empty screen is an invitation, so it names the next action. */
export function EmptyState({
  headline,
  body,
  action,
}: {
  headline: string;
  body: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="panel py-8 text-center">
      <p className="t-h3">{headline}</p>
      <p className="t-small mx-auto mt-2 max-w-[42ch]" style={{ color: "var(--c-ink-soft)" }}>
        {body}
      </p>
      {action && (
        <Link href={action.href} className="btn btn-primary mt-5 inline-flex">
          {action.label}
        </Link>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ table -- */

export function DataTable({
  columns,
  rows,
  caption,
}: {
  columns: { key: string; label: string; numeric?: boolean }[];
  rows: Record<string, React.ReactNode>[];
  caption?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        {caption && <caption className="t-caption pb-2 text-left">{caption}</caption>}
        <thead>
          <tr className="border-b">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className="t-caption py-2 pr-4 font-semibold last:pr-0"
                style={{ textAlign: c.numeric ? "right" : "left" }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="ruled">
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`py-2.5 pr-4 last:pr-0 ${c.numeric ? "t-num" : ""}`}
                  style={{ textAlign: c.numeric ? "right" : "left", fontSize: "var(--t-small)" }}
                >
                  {row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
