import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SeasonsService } from './seasons.service';
import { SeasonsController } from './seasons.controller';

/**
 * Global for the same reason FeaturesModule is: season resolution is
 * cross-cutting. Every report, dashboard and depot query asks "which window am
 * I reading", and the operational gates ask "which season decides whether this
 * loader may load". Importing it into a dozen modules would be noise.
 */
@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [SeasonsController],
  providers: [SeasonsService],
  exports: [SeasonsService],
})
export class SeasonsModule {}
