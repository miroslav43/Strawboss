import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { GeocodeService } from './geocode.service';

/**
 * Reverse-geocode cache (coordinate -> nearest locality). Exported so feeds
 * that carry machine positions (LocationModule) can enrich them with a locality
 * label without each blocking on Nominatim.
 */
@Module({
  imports: [DatabaseModule],
  providers: [GeocodeService],
  exports: [GeocodeService],
})
export class GeocodeModule {}
