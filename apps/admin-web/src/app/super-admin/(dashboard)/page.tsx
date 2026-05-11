'use client';
export const dynamic = 'force-dynamic';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function SuperAdminHome() {
  const router = useRouter();
  useEffect(() => { router.replace('/super-admin/organizations'); }, [router]);
  return null;
}
