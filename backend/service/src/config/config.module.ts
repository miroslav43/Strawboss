import * as path from 'path';
import { Module, Global } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

// __dirname at runtime = dist/config/
// ../../../../ goes: config → dist → service → backend → Strawboss (monorepo root)
const envFilePath = path.resolve(__dirname, '../../../../.env');

@Global()
@Module({
  imports: [NestConfigModule.forRoot({ isGlobal: true, envFilePath })],
})
export class ConfigModule {}
