import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign in",
  description: "One password, one person.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
