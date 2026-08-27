import type { Metadata } from "next";

import { PersonalFooter } from "../components/footer";
import "./globals.css";

const title = "Possibility Atlas";
const description = "Explore bounded, cited possibilities emerging from current events.";
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://flowpathapp.com";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  alternates: { canonical: "/" },
  openGraph: {
    title,
    description,
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Possibility Atlas — see what could happen next" }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        {children}
        <PersonalFooter />
      </body>
    </html>
  );
}
