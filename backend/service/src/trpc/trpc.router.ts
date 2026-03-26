import { initTRPC } from '@trpc/server';
import type { TrpcContext } from './trpc.context';

const t = initTRPC.context<TrpcContext>().create();

export const appRouter = t.router({
  health: t.procedure.query(() => ({ status: 'ok' })),
});

export type AppRouter = typeof appRouter;
