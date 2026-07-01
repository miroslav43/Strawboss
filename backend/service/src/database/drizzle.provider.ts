import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export const DRIZZLE = 'DRIZZLE';

@Injectable()
export class DrizzleProvider implements OnModuleInit {
  public db!: PostgresJsDatabase;
  /** Raw postgres.js client — exposed for connection-pinned work such as
   *  session-level advisory locks (see TripsService.onModuleInit). */
  public client!: ReturnType<typeof postgres>;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const connectionString = this.configService.getOrThrow<string>('DATABASE_URL');
    // The API runs as 2 replicas behind Swarm and DATABASE_URL points at the
    // Supabase session-mode pooler (one upstream server connection held per
    // client connection, pool_size 15). Cap each replica's pool so the fleet
    // fits the pooler budget INCLUDING a rolling deploy: with start-first +
    // parallelism 1 the rollout briefly runs 3 replicas, so the ceiling is
    // 3 × max. max:4 → 12 at peak, 8 steady — leaving headroom for CLI psql
    // (db:migrate, release registration) and one-off admin work. The previous
    // max:8 made 2 replicas alone reach 16 ≥ 15 and starved every CLI
    // connection with EMAXCONNSESSION. (Transaction mode / port 6543 would lift
    // the budget but breaks the session-level pg_advisory_lock in
    // trips.service.ts, so it needs a refactor first — not a drop-in switch.)
    const client = postgres(connectionString, {
      max: 4,
      idle_timeout: 20,
      connect_timeout: 10,
    });
    this.client = client;
    this.db = drizzle(client);
  }
}
