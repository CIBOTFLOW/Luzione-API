import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ConsoleShell } from "@/components/ConsoleShell";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "Luzione Control Plane",
    template: "%s | Luzione Control Plane",
  },
  description: "Live platform health, deterministic business rules, API contracts, and the connection between Luzione App and Sultan OS.",
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#070b12",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geist.variable} ${geistMono.variable}`}>
        <ConsoleShell>{children}</ConsoleShell>
      </body>
    </html>
  );
}
