import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster, TooltipProvider } from '@uipath/apollo-wind';
import { ApiError } from './api/http';
import './index.css';
import { Bootstrap } from './components/setup/Bootstrap';
import { ErrorBoundary } from './components/ErrorBoundary';
import { applyThemeClass, resolveTheme, useThemeStore } from './state/themeStore';

applyThemeClass(resolveTheme(useThemeStore.getState().preference));
useThemeStore.subscribe((s) => applyThemeClass(resolveTheme(s.preference)));

if (typeof window !== 'undefined' && window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (useThemeStore.getState().preference === 'system') {
      applyThemeClass(resolveTheme('system'));
    }
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // The native (webview-bun) window's connections to the local Bun server
      // are flaky for the first ~2-3s after load — the opening request wave
      // gets its sockets RST'd and surfaces as a network error (not a clean
      // cancel). TanStack's default backoff (1s, 2s) turns that transient blip
      // into a multi-second "stuck loading". Retry fast instead so recovery is
      // invisible, but DON'T retry 4xx (bad query, auth) — those aren't transient.
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 429) {
          return false;
        }
        return failureCount < 3;
      },
      retryDelay: (attemptIndex) => Math.min(250 * 2 ** attemptIndex, 2000),
      // The queue must feel current the moment you come back to the window —
      // per-query opt-outs (e.g. immutable per-sha file lists) set this false.
      refetchOnWindowFocus: true,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={150}>
        <ErrorBoundary>
          <Bootstrap />
          <Toaster richColors closeButton />
        </ErrorBoundary>
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>
);
