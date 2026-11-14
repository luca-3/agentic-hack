import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { PRODUCT_NAME } from "@/components/ui";
import "./globals.css";

const plexSans = IBM_Plex_Sans({ variable: "--font-plex-sans", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: `${PRODUCT_NAME} – Admin`,
  description: "We find weak spots in the interface, not in people.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-shell="nachtblau" className={`${plexSans.variable} ${plexMono.variable} antialiased`}>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
