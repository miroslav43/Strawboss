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
    // client connection). Cap each replica's pool so 2 replicas stay within the
    // pooler budget (~16 steady, ~24 peak during a rolling deploy) rather than
    // the postgres.js default of 10 connections per replica.
    const client = postgres(connectionString, {
      max: 8,
      idle_timeout: 20,
      connect_timeout: 10,
    });
    this.client = client;
    this.db = drizzle(client);
  }
}
