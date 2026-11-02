import { Inter_Tight, JetBrains_Mono } from "next/font/google";

/** Display / UI face: 800 for the name and headings, 400–600 for body and UI. Self-hosted at build time. */
export const interTight = Inter_Tight({
  weight: ["400", "500", "600", "800"],
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

/** Labels, nav numbers, metrics, code. */
export const jetbrainsMono = JetBrains_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});
