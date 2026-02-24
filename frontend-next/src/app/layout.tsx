import type { Metadata } from "next";
import { Sora, Space_Mono } from "next/font/google";
import RouteProgressBar from "@/components/layout/RouteProgressBar";
import QueryProvider from "@/components/providers/QueryProvider";
import "./globals.css";

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sora",
  display: "swap"
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  variable: "--font-space-mono",
  display: "swap",
  weight: ["400", "700"]
});

export const metadata: Metadata = {
  title: {
    default: "ImoRadar",
    template: "%s • ImoRadar"
  },
  description: "Modern real-estate search and lead radar.",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/icon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/icon.svg", type: "image/svg+xml" }
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
    shortcut: ["/favicon.ico"]
  }
};


export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className={`${sora.variable} ${spaceMono.variable}`}>
      <body className="min-h-screen bg-black text-white">
        <QueryProvider>
          <RouteProgressBar />
          {children}
        </QueryProvider>
      </body>
    </html>
  );
}
