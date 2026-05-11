'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { Loader2, Building2, Plus, ExternalLink } from 'lucide-react';
import { apiClient } from '@/lib/api';

interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt?: string;
}

export default function OrganizationsPage() {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    void apiClient
      .get<Organization[] | { data: Organization[] }>('/api/v1/organizations')
      .then((res) => {
        const list = Array.isArray(res) ? res : ((res as { data: Organization[] }).data ?? []);
        setOrgs(list);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load organizations');
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-neutral-800">Organizations</h1>
          <p className="mt-0.5 text-sm text-neutral-500">
            Manage all tenant organizations on the platform.
          </p>
        </div>
        <a
          href="/super-admin/organizations/new"
          className="flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
        >
          <Plus className="h-4 w-4" />
          New Organization
        </a>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-neutral-400">
          <Loader2 className="mr-2 h-6 w-6 animate-spin" />
          Loading organizations…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          {error}
        </div>
      ) : orgs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-neutral-400">
          <Building2 className="mb-3 h-12 w-12 opacity-20" />
          <p className="text-sm">No organizations yet.</p>
          <p className="mt-1 text-xs">Click &quot;New Organization&quot; to create the first one.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-100 bg-neutral-50 text-xs font-medium uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-5 py-3 text-left">Name</th>
                <th className="px-5 py-3 text-left">Slug</th>
                <th className="px-5 py-3 text-left">Dashboard</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {orgs.map((org) => (
                <tr key={org.id} className="hover:bg-neutral-50">
                  <td className="px-5 py-3 font-medium text-neutral-800">{org.name}</td>
                  <td className="px-5 py-3 font-mono text-neutral-500">{org.slug}</td>
                  <td className="px-5 py-3">
                    <a
                      href={`/${org.slug}/`}
                      className="inline-flex items-center gap-1 text-neutral-500 hover:text-neutral-800"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      /{org.slug}/
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
