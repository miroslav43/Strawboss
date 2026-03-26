'use client';

import Link from 'next/link';
import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SidebarLinkProps {
  href: string;
  icon: LucideIcon;
  label: string;
  active: boolean;
  expanded: boolean;
}

export function SidebarLink({ href, icon: Icon, label, active, expanded }: SidebarLinkProps) {
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-primary text-white'
          : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900',
        !expanded && 'justify-center px-2',
      )}
      title={!expanded ? label : undefined}
    >
      <Icon className="h-5 w-5 shrink-0" />
      {expanded && <span>{label}</span>}
    </Link>
  );
}
