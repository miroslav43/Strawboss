import type { Metadata } from 'next';
import './globals.css';
import { AppProviders } from './providers';

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);

export const metadata: Metadata = {
  ...(siteUrl ? { metadataBase: new URL(`${siteUrl}/`) } : {}),
  title: 'StrawBoss Admin',
  description: 'Agricultural logistics management',
  applicationName: 'StrawBoss Admin',
  openGraph: {
    title: 'StrawBoss Admin',
    description: 'Agricultural logistics management',
    siteName: 'StrawBoss Admin',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'StrawBoss Admin',
    description: 'Agricultural logistics management',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-background text-neutral-900 antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
