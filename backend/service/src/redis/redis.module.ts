import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { REDIS_CONNECTION } from '../config/redis.config';

/**
 * Provides a shared IORedis connection under the REDIS_CONNECTION token.
 *
 * This is a raw Redis client (separate from the BullMQ queue connections) for
 * features that need direct key access — currently the beneficiary PIN throttle.
 * Connection errors are swallowed; consumers fail open when Redis is unavailable.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CONNECTION,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('REDIS_URL', 'redis://localhost:6379')!;
        const client = new Redis(url, {
          commandTimeout: 1500,
          maxRetriesPerRequest: 1,
        });
        client.on('error', () => undefined);
        return client;
      },
    },
  ],
  exports: [REDIS_CONNECTION],
})
export class RedisModule {}
