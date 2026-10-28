import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

export const metadata: Metadata = {
  metadataBase: siteUrl ? new URL(siteUrl) : undefined,
  title: "EK Voice — EK Graphics TTS",
  description:
    "A focused, accessible text-to-speech workspace for reading articles aloud and creating downloadable MP3 voiceovers.",
  applicationName: "EK Voice",
  keywords: ["text to speech", "TTS", "MP3 voiceover", "accessibility", "EK Graphics"],
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f7f8fc",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
