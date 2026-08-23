import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";

import { ToastProvider } from "@/components/ui/Toast";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "rezervio° — apartamenty i domy wakacyjne",
    template: "%s · rezervio°",
  },
  description:
    "Rezervio to marketplace noclegów z ceną całkowitą od pierwszego ekranu. Gospodarze płacą mniej prowizji, goście płacą mniej za pobyt.",
};

export const viewport: Viewport = {
  themeColor: "#F5F1E8",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pl" className={manrope.variable}>
      <body className="min-h-dvh bg-background text-ink">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
