import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { promises as fsp } from 'node:fs';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { AppModule } from './app.module';
import { resolveUploadsRoot } from './uploads/uploads.service';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { bufferLogs: true },
  );
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
  await fastify.register(fastifyStatic, {
    root: uploadsRoot,
    prefix: '/api/v1/uploads/',
    decorateReply: false,
  });

  const corsOrigins = [
    'https://nortiauno.com',
    'https://www.nortiauno.com',
  ];
  if (process.env.NODE_ENV !== 'production') {
    corsOrigins.push(
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    );
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
  const port = process.env.PORT ?? 3001;
  await app.listen(port, '0.0.0.0');
  app.get(WINSTON_MODULE_NEST_PROVIDER).log(
    `StrawBoss backend listening on ${port}`,
  );
}
bootstrap();
