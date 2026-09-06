/** Progress against a target, as a single ruled bar. Used where a percentage
 *  would hide the two numbers that actually matter — what you got and what you
 *  were aiming at — so both are always printed beside it. */
export function Meter({
  value,
  target,
  color,
  unit,
  label,
}: {
  value: number;
  target: number;
  color: string;
  unit: string;
  label: string;
}) {
  const ratio = target > 0 ? Math.min(1, value / target) : 0;
  const over = value > target;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="t-num" style={{ fontSize: "var(--t-small)" }}>
          <span style={{ fontWeight: 600, fontSize: "var(--t-body)" }}>{Math.round(value)}</span>
          <span style={{ color: "var(--c-ink-faint)" }}>
            {" "}
            / {Math.round(target)} {unit}
          </span>
        </p>
        <p className="t-caption">{over ? "over target" : `${Math.round(ratio * 100)}% of target`}</p>
      </div>
      <div
        className="mt-1.5 h-2 w-full overflow-hidden"
        style={{ background: "var(--c-rule-soft)", borderRadius: "1px" }}
        role="meter"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={Math.round(target)}
        aria-label={label}
      >
        <div
          className="h-full"
          style={{
            width: `${Math.max(ratio * 100, value > 0 ? 1.5 : 0)}%`,
            background: color,
            borderRadius: "1px 4px 4px 1px",
          }}
        />
      </div>
    </div>
  );
}
