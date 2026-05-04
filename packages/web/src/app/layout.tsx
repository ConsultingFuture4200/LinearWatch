import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ThemeProvider } from 'next-themes';
import { Inter, JetBrains_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const jbm = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata = {
  title: 'linearwatch',
  description: 'Cross-agent attribution for Linear workspaces',
};

export default function RootLayout({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${jbm.variable}`}>
      <body className="bg-background text-foreground antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          storageKey="linearwatch-theme"
        >
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
