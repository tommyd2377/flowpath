import type { Metadata } from "next";

import { PersonalFooter } from "../components/footer";
import "./globals.css";

const title = "Possibility Atlas";
const description =
  "Freeze the facts, branch the scenarios, and trace how current events could affect one another.";

export const metadata: Metadata = {
  metadataBase: new URL("http://127.0.0.1:3100"),
  title,
  description,
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
