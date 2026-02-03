import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Escape Hatch Podcast Search',
  description: 'Search through podcast transcripts with AI',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
