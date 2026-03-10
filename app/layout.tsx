import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Intellilake Playgrounds",
  description: "Interactive playgrounds for the Intellilake platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
