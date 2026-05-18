import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

interface PageHeaderProps {
  title: string;
  actions?: React.ReactNode;
  /** When provided, renders a back arrow link to this href before the title. */
  backHref?: string;
}

export function PageHeader({ title, actions, backHref }: PageHeaderProps) {
  return (
    <div className="mb-6 flex items-center justify-between">
      <div className="flex items-center gap-3">
        {backHref && (
          <Link
            href={backHref}
            className="rounded-lg border border-neutral-200 bg-white p-2 text-neutral-500 shadow-sm hover:bg-neutral-50 hover:text-neutral-800"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        )}
        <h1 className="text-2xl font-bold text-neutral-900">{title}</h1>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
