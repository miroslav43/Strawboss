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
