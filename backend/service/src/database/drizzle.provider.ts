import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export const DRIZZLE = 'DRIZZLE';

@Injectable()
export class DrizzleProvider implements OnModuleInit {
  public db!: PostgresJsDatabase;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const connectionString =
      this.configService.getOrThrow<string>('DATABASE_URL');
    const client = postgres(connectionString);
    this.db = drizzle(client);
  }
}
