'use client';

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeQueryClient } from '@/lib/query-client';
import { LocaleProvider } from '@/lib/i18n';
import { LoggingErrorBoundary } from '@/components/shared/LoggingErrorBoundary';

/**
 * Single browser QueryClient singleton so every route (including lazy chunks from
 * @strawboss/api hooks) shares the same React Query context as this provider.
 */
let browserQueryClient: QueryClient | undefined;

function getQueryClient(): QueryClient {
  if (typeof window === 'undefined') {
    return makeQueryClient();
  }
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
        <LoggingErrorBoundary>{children}</LoggingErrorBoundary>
      </LocaleProvider>
    </QueryClientProvider>
  );
}
