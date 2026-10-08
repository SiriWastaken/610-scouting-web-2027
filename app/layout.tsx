import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// The one typeface for the whole app, numbers included (see the tabular-nums rule in globals.css).
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "610 Scouting",
  description: "FRC Team 610 scouting and strategy workspace",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
