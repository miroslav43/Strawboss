import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { promises as fsp } from 'node:fs';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { AppModule } from './app.module';
import { resolveUploadsRoot } from './uploads/uploads.service';
import { verifyUploadSignature } from './uploads/uploads-signing';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    bufferLogs: true,
  });
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));
  app.setGlobalPrefix('api/v1');

  // The NestJS Fastify adapter exposes the underlying instance with
  // `FastifyTypeProvider` (no default). @fastify/multipart and @fastify/static
  // are typed against the default provider (`FastifyTypeProviderDefault`), so
  // `register()` sees a structural mismatch even though the runtime behavior
  // is identical. `any` here is a pragmatic escape hatch — Fastify itself
  // guards against duplicate registration and invalid options.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fastify = app.getHttpAdapter().getInstance() as any;

  // Multipart for receipt uploads. 3 MB is plenty for a compressed WebP photo
  // (mobile targets ~100-200 KB); anything larger is almost certainly wrong.
  await fastify.register(fastifyMultipart, {
    limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  });

  // Serve uploaded receipts over HTTP. Mounted under `/uploads/` on the
  // underlying Fastify instance, which becomes `/api/v1/uploads/...` because
  // NestJS applies the global prefix for controller routes but @fastify/static
  // lives outside Nest routing — so we set the prefix explicitly to match.
  const configService = app.get(ConfigService);
  const uploadsRoot = resolveUploadsRoot(configService);
  await fsp.mkdir(uploadsRoot, { recursive: true });

  // The static route below lives OUTSIDE NestJS routing, so the AuthGuard never
  // runs for it. Gate it with a short-lived HMAC signature instead: every upload
  // URL is signed at response egress (UploadUrlSigningInterceptor) and verified
  // here on each GET. Unsigned / expired / tampered requests get 401 — closing
  // the previously world-readable signatures/receipts/avatars hole.
  const uploadsSecret = configService.getOrThrow<string>('SUPABASE_JWT_SECRET');
  fastify.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    // Only the static file-serving GET/HEAD requests are signature-gated. The
    // POST upload endpoints (/uploads/receipt, /uploads/signature) are Nest
    // controller routes guarded by the AuthGuard — let them through untouched.
    if (req.method !== 'GET' && req.method !== 'HEAD') return;
    const rawUrl: string = req.url ?? '';
    if (!rawUrl.startsWith('/api/v1/uploads/')) return;
    const qIndex = rawUrl.indexOf('?');
    const pathname = qIndex === -1 ? rawUrl : rawUrl.slice(0, qIndex);
    const query = new URLSearchParams(qIndex === -1 ? '' : rawUrl.slice(qIndex + 1));
    const ok = verifyUploadSignature(
      pathname,
      query.get('exp'),
      query.get('sig'),
      uploadsSecret,
      Date.now(),
    );
    if (!ok) {
      return reply.code(401).send({ statusCode: 401, message: 'Invalid or expired upload URL' });
    }
  });

  await fastify.register(fastifyStatic, {
    root: uploadsRoot,
    prefix: '/api/v1/uploads/',
    decorateReply: false,
  });

  const corsOrigins = ['https://nortiauno.com', 'https://www.nortiauno.com'];
  if (process.env.NODE_ENV !== 'production') {
    corsOrigins.push('http://localhost:3000', 'http://127.0.0.1:3000');
  }
  // Production Docker images still use NODE_ENV=production. If you run admin at
  // http://localhost:3000 against this API (e.g. ./strawboss.sh production), add:
  // CORS_EXTRA_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
  const extraOrigins =
    process.env.CORS_EXTRA_ORIGINS?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  for (const o of extraOrigins) {
    if (!corsOrigins.includes(o)) corsOrigins.push(o);
  }

  app.enableCors({
    origin: corsOrigins,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    credentials: true,
  });
  // Graceful shutdown: drain in-flight HTTP requests and let BullMQ workers
  // finish their active jobs before exit. Required for zero-downtime Swarm
  // rolling updates — on SIGTERM the outgoing replica must close cleanly instead
  // of dropping requests. enableShutdownHooks() is also what fires Nest's
  // onModuleDestroy lifecycle (which closes the BullMQ workers), so it must be
  // enabled for the SIGTERM/SIGINT path below to actually drain jobs.
  app.enableShutdownHooks();
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.get(WINSTON_MODULE_NEST_PROVIDER).log(`Received ${signal}, shutting down gracefully…`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  const port = process.env.PORT ?? 3001;
  await app.listen(port, '0.0.0.0');
  app.get(WINSTON_MODULE_NEST_PROVIDER).log(`StrawBoss backend listening on ${port}`);
}
bootstrap();
