'use client';
export const dynamic = 'force-dynamic';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

/**
 * DEPRECATED — kept for one release only, for drivers who already received an
 * old-style "sign the CMR" SMS link before this deploy. Every link sent from
 * now on points straight at `/cmr/[token]` (the arrival-CMR photo upload).
 *
 * This page no longer renders the old signature pad — it just forwards to the
 * new page, which handles the token the same way (same `public_sign_token`,
 * same one-time-use guarantee; see the note on `publicSignToken` in
 * @strawboss/types). The backend still serves `GET/POST /public/sign/:token`
 * for one release as a defense-in-depth fallback, but no UI reaches it anymore.
 *
 * Delete this file (and the backend routes it used to call) once stale links
 * from before the deploy have had time to age out.
 */
export default function PublicSignRedirectPage() {
  const router = useRouter();
  const params = useParams<{ slug: string; token: string }>();

  useEffect(() => {
    router.replace(`/${params.slug}/cmr/${params.token}`);
  }, [router, params.slug, params.token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50">
      <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
    </div>
  );
}
