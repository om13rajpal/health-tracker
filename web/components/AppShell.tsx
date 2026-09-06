"use client";

import { usePathname } from "next/navigation";
import { Rail, TabBar } from "./Nav";

/** Login sits outside the ledger — there is nothing to navigate to until you
 *  are in, so the rail and tab bar would only be dead chrome there. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/login") {
    return <>{children}</>;
  }

  return (
    <div className="shell">
      <Rail />
      {/* The bottom padding clears the tab bar and has to switch at exactly the
          same width the tab bar does — Tailwind's `md` is 768px, which would
          leave content hidden behind it between 768 and 900px. */}
      <div className="shell-content min-w-0">{children}</div>
      <TabBar />
    </div>
  );
}
