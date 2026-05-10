import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Brief - Pre-flight Checklist for AI Agents",
  description: "Local pre-flight checklist shell for safer AI agent handoffs.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
