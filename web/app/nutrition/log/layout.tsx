import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Log food",
  description: "Say what you ate in plain language.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
