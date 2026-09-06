"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { apiFetch } from "../lib/apiFetch";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  // A cold-started free-tier API can take tens of seconds to answer. Blocking
  // on that before rendering anything would turn the "show cached data while
  // the API wakes" the persisted query cache exists for into a blank screen.
  // Children render immediately; the check running in the background can
  // still redirect once it actually confirms the session is gone.
  const [checked, setChecked] = useState(pathname === "/login");

  useEffect(() => {
    if (pathname === "/login") return;

    let cancelled = false;
    apiFetch("/api/auth/whoami")
      .then((res) => {
        // Only a definite "not authenticated" response signs the user out.
        // Any other status (5xx, a proxy error page) is the server being
        // unwell, not the session being invalid, and is left alone the same
        // way a network failure below is.
        if (!cancelled && (res.status === 401 || res.status === 403)) router.push("/login");
      })
      .catch(() => {
        // The server being unreachable — asleep, mid-deploy, offline — is not
        // evidence the session is invalid. Redirecting here would show a
        // login page instead of the cached data the query cache persists
        // exactly for this situation, and would do it on every network blip.
      })
      .finally(() => {
        if (!cancelled) setChecked(true);
      });

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  // Before the first check resolves, `checked` is only pre-set true for
  // /login itself; every other route waits one tick so a definite 401 still
  // redirects before the protected page flashes on screen with no data.
  if (!checked) return null;

  return <>{children}</>;
}
