import { redirect } from 'next/navigation';

/**
 * "Solicitări curse" now lives on the Curse page, as the intake strip + the
 * "Curse Aux" ledger.
 *
 * The route is KEPT as a redirect rather than deleted. It costs nothing, and it
 * protects every bookmark, browser-history entry and link a dispatcher pasted
 * into a chat. Deleting the directory would 404 all of them.
 */
export default async function TripRequestsRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/${slug}/trips#aux`);
}
