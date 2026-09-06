"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../lib/apiFetch";
import { IconAlert } from "../../components/icons";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await apiFetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.status === 401) {
        setError("That password doesn't match. Try again.");
        return;
      }
      if (res.status !== 200) {
        setError("The server refused the sign-in. Try again in a moment.");
        return;
      }
      router.push("/");
    } catch {
      // The API being unreachable (offline, DNS failure) is a distinct case
      // from a wrong password — without this catch, a network error here
      // throws an unhandled rejection and the form just silently does nothing.
      setError("Can't reach the server. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="band flex min-h-[100dvh] flex-col justify-center">
      <div className="measure w-full max-w-xl py-16">
        <p className="t-caption">Ledger</p>
        <h1 className="t-hero mt-2" style={{ color: "var(--c-on-ink)" }}>
          Om&rsquo;s training record
        </h1>
        <p className="t-lead mt-4 max-w-[40ch]">
          Twelve weeks of training, food and sleep, kept in one place. One password, one person.
        </p>

        <form onSubmit={handleSubmit} className="mt-10 max-w-sm">
          <label htmlFor="password" className="label" style={{ color: "var(--c-on-ink-soft)" }}>
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field"
            style={{
              background: "transparent",
              borderColor: "var(--c-on-ink-rule)",
              color: "var(--c-on-ink)",
            }}
            disabled={isSubmitting}
            aria-describedby={error ? "login-error" : undefined}
            aria-invalid={error ? true : undefined}
          />

          {error && (
            <p
              id="login-error"
              role="alert"
              className="t-small mt-3 flex items-start gap-2"
              style={{ color: "var(--c-bad-on-band)" }}
            >
              <span className="mt-px flex-none">
                <IconAlert size={16} />
              </span>
              {error}
            </p>
          )}

          <button
            type="submit"
            className="btn btn-on-band mt-5 w-full"
            disabled={isSubmitting || password.length === 0}
          >
            {isSubmitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
