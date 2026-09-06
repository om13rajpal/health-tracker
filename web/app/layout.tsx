import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import { QueryProvider } from "./providers";
import { AuthGuard } from "./AuthGuard";
import { AppShell } from "../components/AppShell";

// Archivo carries a width axis, which the headline styles run out to 112% —
// the wide setting is what gives the numbers their signage feel.
const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
  variable: "--font-archivo",
});

// Numerals only: set notation, weights, clock times, table columns.
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: { default: "Ledger", template: "%s · Ledger" },
  description: "A training, nutrition and sleep record.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eff0ea" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1714" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${plexMono.variable}`}>
      <body>
        <AuthGuard>
          <QueryProvider>
            <AppShell>{children}</AppShell>
          </QueryProvider>
        </AuthGuard>
      </body>
    </html>
  );
}
