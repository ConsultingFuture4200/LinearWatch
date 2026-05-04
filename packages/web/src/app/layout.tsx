import type { ReactNode } from 'react';

export const metadata = {
  title: 'agentwatch',
  description: 'Self-hosted observability for AI agents in Linear workspaces',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
