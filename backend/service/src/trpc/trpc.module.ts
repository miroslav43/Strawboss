import { Module } from '@nestjs/common';

/**
 * tRPC module scaffold. The router is defined in trpc.router.ts and
 * can be integrated with the NestJS HTTP adapter for tRPC endpoint serving.
 *
 * To serve tRPC over the Fastify adapter, integrate in main.ts or
 * add a controller that delegates to the tRPC handler.
 */
@Module({})
export class TrpcModule {}
