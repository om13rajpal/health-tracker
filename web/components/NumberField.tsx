"use client";

/** A numeric entry sized for a thumb between sets: a wide tabular field with a
 *  step down and step up either side, so a working weight can be nudged without
 *  aiming at a keyboard. Zero renders as an empty field rather than a literal
 *  "0", which otherwise has to be selected and deleted before typing. */
export function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min = 0,
  max,
  placeholder,
  suffix,
  id,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  step?: number;
  min?: number;
  max?: number;
  placeholder?: string;
  suffix?: string;
  id?: string;
}) {
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min, n));
  // Steps land on clean values (2.5 kg plates, whole reps) even when the field
  // was typed into with something off-grid.
  const nudge = (direction: 1 | -1) =>
    onChange(clamp(Number((Math.round((value + direction * step) / step) * step).toFixed(2))));

  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <div className="flex items-stretch gap-1">
        <button
          type="button"
          className="btn btn-secondary min-h-11 w-10 px-0"
          onClick={() => nudge(-1)}
          aria-label={`Decrease ${label.toLowerCase()}`}
        >
          −
        </button>
        <div className="relative flex-1">
          <input
            id={id}
            type="number"
            inputMode="decimal"
            step={step}
            min={min}
            max={max}
            placeholder={placeholder}
            value={value === 0 ? "" : value}
            onChange={(e) => onChange(e.target.value === "" ? 0 : clamp(Number(e.target.value)))}
            className="field field-num"
          />
          {suffix && value !== 0 && (
            <span
              aria-hidden
              className="t-caption pointer-events-none absolute right-2 top-1/2 -translate-y-1/2"
            >
              {suffix}
            </span>
          )}
        </div>
        <button
          type="button"
          className="btn btn-secondary min-h-11 w-10 px-0"
          onClick={() => nudge(1)}
          aria-label={`Increase ${label.toLowerCase()}`}
        >
          +
        </button>
      </div>
    </div>
  );
}
