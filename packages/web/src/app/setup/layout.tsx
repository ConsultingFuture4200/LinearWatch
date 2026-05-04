import type { ReactNode } from 'react';

/**
 * Setup wizard layout — minimal top bar, full-width content. The wizard
 * deliberately does NOT show the dashboard nav: the user has not finished
 * onboarding yet and the dashboard tabs would be misleading.
 */
export default function SetupLayout({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-screen-2xl items-center px-6">
          <span className="font-mono text-sm text-foreground">linearwatch</span>
          <span className="ml-3 text-xs text-muted-foreground">setup</span>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
