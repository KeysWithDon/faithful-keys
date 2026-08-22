import type { Metadata } from "next";
import "./globals.css";
import "./spacing.css";

export const metadata: Metadata = {
  title: "Faithful Keys — Chord Progression Maker & Voicing Teacher",
  description: "Build chord progressions, explore harmony, and learn beautiful piano voicings.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{__html:`try{const saved=localStorage.getItem("faithful-keys-theme")||localStorage.getItem("cadence-theme");const theme=saved||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme}catch{}`}} />
      </head>
      <body>{children}</body>
    </html>
  );
}
