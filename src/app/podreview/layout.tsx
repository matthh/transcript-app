import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'PodReview - Escape Hatch',
};

export default function PodReviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #0b0f14, #0a1220 60%)',
      colorScheme: 'dark',
    }}>
      {children}
    </div>
  );
}
