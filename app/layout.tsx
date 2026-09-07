import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'The Voice',
  description: 'A little space to think out loud. A quiet, real-time voice conversation.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
