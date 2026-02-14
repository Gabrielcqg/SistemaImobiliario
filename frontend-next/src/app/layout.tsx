import type { Metadata } from "next";
import { Sora, Space_Mono } from "next/font/google";
import RouteProgressBar from "@/components/layout/RouteProgressBar";
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
  title: "Projeto Imobiliária",
  description: "Frontend moderno para o projeto imobiliário"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className={`${sora.variable} ${spaceMono.variable}`}>
      <body className="min-h-screen bg-black text-white">
        <RouteProgressBar />
        {children}
      </body>
    </html>
  );
}
