import { Global, Module } from '@nestjs/common';
import { WinstonModule } from 'nest-winston';
import { createApplicationWinstonOptions } from './winston-factory';

@Global()
@Module({
  imports: [
    WinstonModule.forRoot(createApplicationWinstonOptions()),
  ],
  exports: [WinstonModule],
})
export class AppLoggerModule {}
