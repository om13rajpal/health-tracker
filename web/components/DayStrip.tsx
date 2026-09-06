"use client";

import { useId, useState } from "react";
import { DOMAINS, DOMAIN_ORDER, type DomainKey } from "../lib/domains";

/** One day of the record. A `null` reading means nothing was recorded that
 *  day, which the strip draws as a hollow mark rather than hiding — the gaps
 *  are the most honest part of a training log. */
export type LedgerDay = {
  date: string;
  readings: Record<DomainKey, number | null>;
  /** Human-readable value per domain, shown on hover. */
  detail: Record<DomainKey, string>;
};

type Props = {
  days: LedgerDay[];
  /** Renders against the dark band rather than on paper. */
  onBand?: boolean;
  /** Show only one domain's row — used as a domain page's header. */
  only?: DomainKey;
};

/** Five steps of one hue against the surface behind it — a sequential ramp per
 *  domain. The floor sits well above zero so a recorded-but-empty day (a rest
 *  day, a day you ate nothing logged) still reads as a mark, clearly different
 *  from the hollow outline that means nothing was recorded at all. */
function fillFor(value: number | null, color: string, ground: string): string {
  if (value === null) return "transparent";
  const step = value <= 0.001 ? 20 : value < 0.4 ? 40 : value < 0.7 ? 62 : value < 1 ? 82 : 100;
  return `color-mix(in oklab, ${color} ${step}%, ${ground})`;
}

function formatDay(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function DayStrip({ days, onBand = false, only }: Props) {
  const [hovered, setHovered] = useState<LedgerDay | null>(null);
  const captionId = useId();

  const rows = only ? [only] : DOMAIN_ORDER;
  const ground = onBand ? "var(--c-band)" : "var(--c-field)";
  const hairline = onBand ? "var(--c-on-ink-rule)" : "var(--c-rule)";
  const shown = hovered ?? days[days.length - 1];

  // One tick per month boundary, so twelve weeks of marks stay locatable.
  const monthTicks = days.map((day, i) => {
    const previous = days[i - 1];
    const isFirst = i === 0 || new Date(`${day.date}T00:00:00`).getMonth() !== new Date(`${previous.date}T00:00:00`).getMonth();
    return isFirst && i > 2
      ? new Date(`${day.date}T00:00:00`).toLocaleDateString("en-IN", { month: "short" })
      : null;
  });

  return (
    <figure className="m-0">
      <div className="strip-wrap flex items-start gap-3">
        {/* Row labels are the secondary encoding: the strip never asks you to
            tell the domains apart by colour alone. */}
        <div className="strip-labels flex-none">
          {rows.map((key) => (
            <span key={key} className="t-caption" style={{ color: onBand ? "var(--c-on-ink-soft)" : "var(--c-ink-faint)" }}>
              {DOMAINS[key].label}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div
            className="strip"
            onMouseLeave={() => setHovered(null)}
            role="img"
            aria-describedby={captionId}
            aria-label={`Daily record for the last ${days.length} days across training, eating, sleep and movement.`}
          >
            {days.map((day) => (
              <div
                key={day.date}
                className="strip-day cursor-default"
                onMouseEnter={() => setHovered(day)}
                // There is no hover on a phone, so a touch has to reach the
                // caption too — otherwise the strip is decoration on mobile.
                onTouchStart={() => setHovered(day)}
              >
                {rows.map((key) => {
                  const value = day.readings[key];
                  return (
                    <span
                      key={key}
                      className="strip-mark"
                      style={{
                        background: fillFor(value, onBand ? DOMAINS[key].bandColor : DOMAINS[key].color, ground),
                        boxShadow:
                          value === null
                            ? `inset 0 0 0 1px ${hairline}`
                            : hovered?.date === day.date
                              ? `0 0 0 1.5px ${onBand ? "var(--c-on-ink)" : "var(--c-ink)"}`
                              : undefined,
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>

          <div className="strip mt-1" aria-hidden>
            {monthTicks.map((tick, i) => (
              <span
                key={days[i].date}
                className="t-caption whitespace-nowrap"
                style={{ color: onBand ? "var(--c-on-ink-soft)" : "var(--c-ink-faint)", overflow: "visible" }}
              >
                {tick}
              </span>
            ))}
          </div>
        </div>
      </div>

      <figcaption
        id={captionId}
        className="t-caption mt-2.5 flex flex-wrap items-baseline gap-x-4 gap-y-1"
        style={{ color: onBand ? "var(--c-on-ink-soft)" : "var(--c-ink-faint)" }}
      >
        {shown ? (
          <>
            <span className="t-num" style={{ color: onBand ? "var(--c-on-ink)" : "var(--c-ink)" }}>
              {formatDay(shown.date)}
            </span>
            {rows.map((key) => (
              <span key={key}>
                {DOMAINS[key].label} {shown.detail[key]}
              </span>
            ))}
          </>
        ) : (
          <span>No days recorded yet.</span>
        )}
      </figcaption>
    </figure>
  );
}
