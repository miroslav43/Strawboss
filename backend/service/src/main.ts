import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  app.setGlobalPrefix('api/v1');

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
  console.log(`StrawBoss backend running on port ${port}`);
}
bootstrap();
