import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ledger — training record",
    short_name: "Ledger",
    description: "Training, food and sleep, kept as one continuous record.",
    start_url: "/",
    display: "standalone",
    // Matches the page ground, so the splash and status bar do not flash white
    // before the app paints.
    background_color: "#eff0ea",
    theme_color: "#15211c",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon.png", sizes: "512x512", type: "image/png" },
      // The mark is drawn inside the safe area, so it survives Android's mask.
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
