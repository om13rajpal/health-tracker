import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Coach",
  description: "One note a week, written against the record.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
