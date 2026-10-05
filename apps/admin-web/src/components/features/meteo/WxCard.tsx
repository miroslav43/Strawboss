import type { ReactNode } from 'react';

/** Shared card shell for the weather section: one look, one place to tune it. */
export function WxCard({
  title,
  icon,
  right,
  children,
  className = '',
}: {
  title: string;
  icon?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          {icon}
          {title}
        </h2>
        {right}
      </div>
      {children}
    </section>
  );
}

/** Muted placeholder for a value the source did not provide. */
export function Unavailable({ label }: { label: string }) {
  return <span className="text-sm text-neutral-400">{label}</span>;
}
