import type { Metadata } from "next";

export const metadata: Metadata = {
  // `default` titles this segment; `template` is what its child routes (the
  // logging forms) inherit — a plain string here would leave them untitled.
  title: { default: "Sleep", template: "%s · Ledger" },
  description: "When you slept, and how steady the schedule held.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
