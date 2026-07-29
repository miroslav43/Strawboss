import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { FeaturesService } from './features.service';
import { FeaturesCacheService } from './features-cache.service';
import { FeaturesGuard } from './features.guard';
import { SuperAdminFeaturesController } from './super-admin-features.controller';

/**
 * Global because the flag gate is cross-cutting: AuthGuard resolves flags on
 * every authenticated request, the guard runs on every write route, and the
 * public-portal services assert per-org enablement inline. Mirrors AuthModule.
 */
@Global()
@Module({
  imports: [DatabaseModule, OrganizationsModule],
  controllers: [SuperAdminFeaturesController],
  providers: [FeaturesService, FeaturesCacheService, FeaturesGuard],
  exports: [FeaturesService, FeaturesCacheService, FeaturesGuard],
})
export class FeaturesModule {}
