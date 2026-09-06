import type { Metadata } from "next";

export const metadata: Metadata = {
  // `default` titles this segment; `template` is what its child routes (the
  // logging forms) inherit — a plain string here would leave them untitled.
  title: { default: "Train", template: "%s · Ledger" },
  description: "What you lifted, and what the programme wants next.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
