import type { Metadata } from 'next';
import './globals.css';
import { SessionProvider } from '@/context/SessionContext';

export const metadata: Metadata = {
  title: 'Tumaini — Hear Hope From Your Future Self',
  description:
    'An AI-powered Future Self voice simulator helping you hear personalized encouragement when life feels difficult.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
