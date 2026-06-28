import { NextResponse } from 'next/server';

// Liveness probe for the Docker Swarm healthcheck (see docker-stack.yml).
// Kept dependency-free and auth-free so a rolling deploy can gate the new admin
// task on a fast, deterministic 200. `force-static` => the standalone server
// answers from cache without invoking the React renderer or any data fetch.
export const dynamic = 'force-static';

export function GET() {
  return NextResponse.json({ status: 'ok' });
}
