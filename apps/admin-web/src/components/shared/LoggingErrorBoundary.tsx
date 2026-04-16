'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { clientLogger } from '@/lib/client-logger';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Captures uncaught React render errors and records them via {@link clientLogger}.
 */
export class LoggingErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    clientLogger.error(error.message, {
      name: error.name,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 p-8 text-center">
          <p className="text-lg font-semibold text-neutral-900">
            Something went wrong
          </p>
          <p className="text-sm text-neutral-600">
            The error was logged. Try refreshing the page.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
          >
            {'Re\u00EEncarc\u0103 pagina'}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
