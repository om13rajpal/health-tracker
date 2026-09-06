"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconCoach, IconEat, IconSleep, IconToday, IconTrain } from "./icons";
import { usePendingOutboxCount } from "../lib/useOutbox";

type Destination = {
  href: string;
  label: string;
  domain: string;
  Icon: (props: { size?: number }) => React.ReactElement;
};

const DESTINATIONS: Destination[] = [
  { href: "/", label: "Today", domain: "var(--c-ink)", Icon: IconToday },
  { href: "/train", label: "Train", domain: "var(--c-moss)", Icon: IconTrain },
  { href: "/nutrition", label: "Eat", domain: "var(--c-marigold)", Icon: IconEat },
  { href: "/sleep", label: "Sleep", domain: "var(--c-indigo)", Icon: IconSleep },
  { href: "/coach-notes", label: "Coach", domain: "var(--c-rust)", Icon: IconCoach },
];

function isCurrent(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Rail() {
  const pathname = usePathname();
  const pending = usePendingOutboxCount();

  return (
    <nav className="rail" aria-label="Sections">
      <Link href="/" className="mb-6 block px-2.5 no-underline">
        <span className="t-h3 block text-ink">Ledger</span>
        <span className="t-caption block">Om&rsquo;s training record</span>
      </Link>

      {DESTINATIONS.map(({ href, label, domain, Icon }) => (
        <Link
          key={href}
          href={href}
          className="rail-link"
          style={{ ["--domain" as string]: domain }}
          aria-current={isCurrent(pathname, href) ? "page" : undefined}
        >
          <Icon size={18} />
          {label}
        </Link>
      ))}

      <div className="mt-auto px-2.5">
        <SyncStatus pending={pending} />
      </div>
    </nav>
  );
}

export function TabBar() {
  const pathname = usePathname();

  return (
    <nav className="tabbar" aria-label="Sections">
      {DESTINATIONS.map(({ href, label, domain, Icon }) => (
        <Link
          key={href}
          href={href}
          className="tab"
          style={{ ["--domain" as string]: domain }}
          aria-current={isCurrent(pathname, href) ? "page" : undefined}
        >
          <Icon size={20} />
          {label}
        </Link>
      ))}
    </nav>
  );
}

/** States plainly whether anything logged on this device is still waiting to
 *  reach the server — the one thing that would quietly cost data. */
export function SyncStatus({ pending }: { pending: number }) {
  if (pending === 0) {
    return (
      <p className="t-caption">
        Everything logged here has reached the server.
      </p>
    );
  }
  return (
    <p className="t-caption" style={{ color: "var(--c-warn)" }}>
      <span className="t-num">{pending}</span> {pending === 1 ? "entry" : "entries"} saved on this device, waiting to
      sync.
    </p>
  );
}
