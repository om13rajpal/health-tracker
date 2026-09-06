import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Log a session",
  description: "Record a set while you are still in the gym.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
