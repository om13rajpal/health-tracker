import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Log a night",
  description: "Record a night Apple Health missed.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
