"use client";

import { useState } from "react";
import { useSize } from "../lib/useSize";

export type Point = {
  /** ISO date, used for ordering and for the tooltip's label. */
  x: string;
  /** `null` is a genuine gap in the record and is drawn as one — never zero. */
  y: number | null;
};

type Props = {
  points: Point[];
  kind?: "line" | "bar";
  color?: string;
  /** Appended to values in labels and tooltips, e.g. "kg", "g", "min". */
  unit?: string;
  /** A horizontal reference, e.g. a protein target or a wake-time goal. */
  reference?: { value: number; label: string };
  /** Forces the y axis to include zero. Bars always do. */
  zeroBased?: boolean;
  height?: number;
  /** Names the single series for screen readers; no legend is drawn because
   *  one series needs none — the surrounding heading names it. */
  label: string;
  formatValue?: (value: number) => string;
};

const PAD = { top: 14, right: 14, bottom: 22, left: 46 };

function ticksAtStep(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 0.001; v += step) {
    out.push(Number(v.toFixed(6)));
  }
  return out;
}

function niceTicks(min: number, max: number): number[] {
  if (min === max) return [min];
  const span = max - min;
  const magnitude = 10 ** Math.floor(Math.log10(span / 4));
  const steps = [1, 2, 2.5, 5, 10].map((m) => m * magnitude);
  const step = steps.find((s) => s >= span / 4) ?? magnitude * 10;
  let ticks = ticksAtStep(min, max, step);
  // A round step can land only one gridline inside a narrow range, which reads
  // as an unlabelled chart. Step down until the axis actually says something.
  for (let i = steps.indexOf(step) - 1; ticks.length < 3 && i >= 0; i--) {
    ticks = ticksAtStep(min, max, steps[i]);
  }
  return ticks;
}

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function Chart({
  points,
  kind = "line",
  color = "var(--c-moss)",
  unit = "",
  reference,
  zeroBased = false,
  height = 210,
  label,
  formatValue = (v) => `${Math.round(v * 10) / 10}`,
}: Props) {
  const { ref, width } = useSize<HTMLElement>();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const values = points.map((p) => p.y).filter((v): v is number => v !== null);
  if (points.length === 0 || values.length === 0) {
    // Still carries the measuring ref, so the chart is sized correctly the
    // moment data arrives rather than staying at its fallback width.
    return (
      <p ref={ref} className="t-small" style={{ color: "var(--c-ink-faint)" }}>
        Nothing recorded in this window yet.
      </p>
    );
  }

  const w = Math.max(width, 240);
  const h = height;
  const innerW = w - PAD.left - PAD.right;
  const innerH = h - PAD.top - PAD.bottom;

  const rawMin = Math.min(...values, reference?.value ?? Infinity);
  const rawMax = Math.max(...values, reference?.value ?? -Infinity);
  const padding = (rawMax - rawMin) * 0.12 || Math.abs(rawMax) * 0.1 || 1;
  const min = kind === "bar" || zeroBased ? Math.min(0, rawMin) : rawMin - padding;
  const max = rawMax + padding;

  const xOf = (i: number) =>
    PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const yOf = (v: number) => PAD.top + innerH - ((v - min) / (max - min || 1)) * innerH;

  // Break the path at gaps rather than bridging them — a bridged line would
  // invent days that were never recorded.
  const segments: string[] = [];
  let current: string[] = [];
  points.forEach((p, i) => {
    if (p.y === null) {
      if (current.length > 1) segments.push(current.join(" "));
      current = [];
      return;
    }
    current.push(`${current.length === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(p.y).toFixed(1)}`);
  });
  if (current.length > 1) segments.push(current.join(" "));

  const ticks = niceTicks(min, max);
  const lastWithValue = [...points].reverse().find((p) => p.y !== null);
  const lastIndex = lastWithValue ? points.lastIndexOf(lastWithValue) : -1;
  const active = hoverIndex !== null ? points[hoverIndex] : null;

  const barWidth = Math.max(1.5, Math.min(14, (innerW / points.length) * 0.72));

  function handleMove(event: React.MouseEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const relative = event.clientX - box.left - PAD.left;
    const index = Math.round((relative / innerW) * (points.length - 1));
    setHoverIndex(Math.max(0, Math.min(points.length - 1, index)));
  }

  return (
    <figure className="m-0" ref={ref}>
      <div className="relative">
        <svg
          width={w}
          height={h}
          viewBox={`0 0 ${w} ${h}`}
          role="img"
          aria-label={`${label}. ${values.length} readings, from ${formatValue(Math.min(...values))}${unit} to ${formatValue(Math.max(...values))}${unit}.`}
          onMouseMove={handleMove}
          onMouseLeave={() => setHoverIndex(null)}
          style={{ display: "block", touchAction: "pan-y" }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={w - PAD.right}
                y1={yOf(t)}
                y2={yOf(t)}
                stroke="var(--c-rule-soft)"
                strokeWidth="1"
              />
              <text
                x={PAD.left - 8}
                y={yOf(t)}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize="10.5"
                fill="var(--c-ink-faint)"
                fontFamily="var(--font-plex-mono), monospace"
              >
                {formatValue(t)}
              </text>
            </g>
          ))}

          {reference && (
            <>
              <line
                x1={PAD.left}
                x2={w - PAD.right}
                y1={yOf(reference.value)}
                y2={yOf(reference.value)}
                stroke="var(--c-ink-faint)"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              <text
                x={w - PAD.right}
                y={yOf(reference.value) - 5}
                textAnchor="end"
                fontSize="10.5"
                fill="var(--c-ink-faint)"
              >
                {reference.label}
              </text>
            </>
          )}

          {kind === "bar"
            ? points.map((p, i) =>
                p.y === null ? null : (
                  <rect
                    key={p.x}
                    x={xOf(i) - barWidth / 2}
                    y={Math.min(yOf(p.y), yOf(Math.max(min, 0)))}
                    width={barWidth}
                    height={Math.max(1.5, Math.abs(yOf(p.y) - yOf(Math.max(min, 0))))}
                    rx={Math.min(3, barWidth / 2)}
                    fill={color}
                    opacity={hoverIndex === null || hoverIndex === i ? 1 : 0.45}
                  />
                )
              )
            : segments.map((d) => (
                <path
                  key={d.slice(0, 24)}
                  d={d}
                  fill="none"
                  stroke={color}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}

          {kind === "line" && lastIndex >= 0 && lastWithValue?.y !== null && lastWithValue !== undefined && (
            <circle
              cx={xOf(lastIndex)}
              cy={yOf(lastWithValue.y as number)}
              r="4.5"
              fill={color}
              stroke="var(--c-field)"
              strokeWidth="2"
            />
          )}

          {active && active.y !== null && hoverIndex !== null && (
            <>
              <line
                x1={xOf(hoverIndex)}
                x2={xOf(hoverIndex)}
                y1={PAD.top}
                y2={PAD.top + innerH}
                stroke="var(--c-ink-faint)"
                strokeWidth="1"
              />
              {kind === "line" && (
                <circle
                  cx={xOf(hoverIndex)}
                  cy={yOf(active.y)}
                  r="5"
                  fill={color}
                  stroke="var(--c-field)"
                  strokeWidth="2"
                />
              )}
            </>
          )}

          <text x={PAD.left} y={h - 5} fontSize="10.5" fill="var(--c-ink-faint)">
            {shortDate(points[0].x)}
          </text>
          <text x={w - PAD.right} y={h - 5} textAnchor="end" fontSize="10.5" fill="var(--c-ink-faint)">
            {shortDate(points[points.length - 1].x)}
          </text>
        </svg>

        {active && (
          <div
            className="panel pointer-events-none absolute z-10 px-2.5 py-1.5"
            style={{
              left: Math.min(Math.max(xOf(hoverIndex ?? 0) - 60, 0), Math.max(w - 132, 0)),
              top: 0,
              minWidth: "7.5rem",
            }}
          >
            <p className="t-caption">{shortDate(active.x)}</p>
            <p className="t-num" style={{ fontSize: "var(--t-body)", fontWeight: 600 }}>
              {active.y === null ? "not recorded" : `${formatValue(active.y)}${unit}`}
            </p>
          </div>
        )}
      </div>
    </figure>
  );
}
