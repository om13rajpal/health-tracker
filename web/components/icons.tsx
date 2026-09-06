// Glyphs drawn from what this app actually measures — a day column, a loaded
// bar, a thali, the arc from bed to wake — rather than a generic icon set.

type IconProps = { size?: number; className?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 20 20",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

/** Four stacked marks — the day column that the ledger is built from. */
export function IconToday({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="2.5" y="3" width="3.6" height="14" rx="0.6" />
      <rect x="8.2" y="6" width="3.6" height="11" rx="0.6" fill="currentColor" stroke="none" />
      <rect x="13.9" y="9.5" width="3.6" height="7.5" rx="0.6" />
    </svg>
  );
}

/** A loaded barbell, seen end-on down the bar. */
export function IconTrain({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M2 8v4M5 6.5v7M15 6.5v7M18 8v4" />
      <path d="M5 10h10" />
    </svg>
  );
}

/** A thali — the plate this app's food is actually eaten off. */
export function IconEat({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="10" cy="10" r="7.5" />
      <circle cx="10" cy="10" r="3.1" />
      <path d="M10 2.5v3.9M15.3 6.5l-2.7 2.2M15.3 13.5l-2.7-2.2M4.7 6.5l2.7 2.2M4.7 13.5l2.7-2.2" />
    </svg>
  );
}

/** The arc from bed time to wake time, with its midpoint marked. */
export function IconSleep({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M2.5 14.5C2.5 9.5 5.9 5.5 10 5.5s7.5 4 7.5 9" />
      <circle cx="10" cy="5.5" r="1.4" fill="currentColor" stroke="none" />
      <path d="M2.5 17.5h15" />
    </svg>
  );
}

/** A note left in the margin of the log. */
export function IconCoach({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M3.5 3.5h13v9.5H9L5 16.5V13H3.5z" />
      <path d="M6.8 7.2h6.4M6.8 10h4" />
    </svg>
  );
}

export function IconPlus({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M10 4.5v11M4.5 10h11" />
    </svg>
  );
}

export function IconBack({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 4.5 6.5 10l5.5 5.5" />
    </svg>
  );
}

export function IconCheck({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="m4.5 10.5 3.6 3.5 7.4-8" />
    </svg>
  );
}

export function IconAlert({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 6v4.8M10 13.6v.4" />
    </svg>
  );
}

export function IconSync({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M16.5 8.2A6.8 6.8 0 0 0 4.6 6.1M3.5 11.8a6.8 6.8 0 0 0 11.9 2.1" />
      <path d="M16.8 3.8v4.4h-4.4M3.2 16.2v-4.4h4.4" />
    </svg>
  );
}

export function IconTrash({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4.5 6h11M8 6V4.2h4V6M6 6l.7 10h6.6L14 6" />
    </svg>
  );
}
