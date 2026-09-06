import type { Metadata } from "next";

export const metadata: Metadata = {
  // `default` titles this segment; `template` is what its child routes (the
  // logging forms) inherit — a plain string here would leave them untitled.
  title: { default: "Eat", template: "%s · Ledger" },
  description: "Protein against target, and what today actually cost.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
