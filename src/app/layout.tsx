import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ConsoleShell } from "@/components/ConsoleShell";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Luzione API Platform",
  description: "Canonical business objects, events, workflows, integrations and reliability for Luzione.",
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
