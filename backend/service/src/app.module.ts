import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AppLoggerModule } from './logger/logger.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { UploadUrlSigningInterceptor } from './common/interceptors/upload-url-signing.interceptor';
import { ConfigModule } from './config/config.module';
import { RedisModule } from './redis/redis.module';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { FeaturesModule } from './features/features.module';
import { FeaturesGuard } from './features/features.guard';
import { AuthGuard } from './auth/auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { ParcelsModule } from './parcels/parcels.module';
import { MachinesModule } from './machines/machines.module';
import { TaskAssignmentsModule } from './task-assignments/task-assignments.module';
import { TripsModule } from './trips/trips.module';
import { BaleLoadsModule } from './bale-loads/bale-loads.module';
import { BaleProductionsModule } from './bale-productions/bale-productions.module';
import { FuelLogsModule } from './fuel-logs/fuel-logs.module';
import { ConsumableLogsModule } from './consumable-logs/consumable-logs.module';
import { DocumentsModule } from './documents/documents.module';
import { CmrScansModule } from './cmr-scans/cmr-scans.module';
import { AlertsModule } from './alerts/alerts.module';
import { AuditModule } from './audit/audit.module';
import { SyncModule } from './sync/sync.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { LocationModule } from './location/location.module';
import { AdminUsersModule } from './admin-users/admin-users.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ReportsModule } from './reports/reports.module';
import { JobsModule } from './jobs/jobs.module';
import { TrpcModule } from './trpc/trpc.module';
import { ProfileModule } from './profile/profile.module';
import { FarmsModule } from './farms/farms.module';
import { ParcelDailyStatusModule } from './parcel-daily-status/parcel-daily-status.module';
import { DeliveryDestinationsModule } from './delivery-destinations/delivery-destinations.module';
import { NotificationsModule } from './notifications/notifications.module';
import { GeofenceModule } from './geofence/geofence.module';
import { MobileLogsModule } from './mobile-logs/mobile-logs.module';
import { HealthModule } from './health/health.module';
import { UploadsModule } from './uploads/uploads.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { DevModule } from './dev/dev.module';
import { DepositInventoryModule } from './deposit-inventory/deposit-inventory.module';
import { MessagingModule } from './messaging/messaging.module';
import { MessagesModule } from './messages/messages.module';
import { TripRequestsModule } from './trip-requests/trip-requests.module';
import { FleetModule } from './fleet/fleet.module';
import { BeneficiariesModule } from './beneficiaries/beneficiaries.module';
import { TransporterModule } from './transporter/transporter.module';

// Dev-only mock simulator endpoints — gated behind NODE_ENV so production
// stays clean. STRAWBOSS_ENABLE_DEV=1 forces them on (e.g. for staging
// where you want to keep the toy endpoints around).
const devModules =
  process.env.NODE_ENV !== 'production' || process.env.STRAWBOSS_ENABLE_DEV === '1'
    ? [DevModule]
    : [];

@Module({
  imports: [
    AppLoggerModule,
    HealthModule,
    ConfigModule,
    RedisModule,
    DatabaseModule,
    // Before AuthModule: AuthGuard injects FeaturesService to resolve an org's
    // flags inside the users/organizations join it already runs per request.
    FeaturesModule,
    MessagingModule,
    MessagesModule,
    OrganizationsModule,
    AuthModule,
    ParcelsModule,
    MachinesModule,
    TaskAssignmentsModule,
    TripsModule,
    BaleLoadsModule,
    BaleProductionsModule,
    FuelLogsModule,
    ConsumableLogsModule,
    DocumentsModule,
    CmrScansModule,
    AlertsModule,
    AuditModule,
    SyncModule,
    ReconciliationModule,
    LocationModule,
    AdminUsersModule,
    DashboardModule,
    ReportsModule,
    JobsModule,
    TrpcModule,
    ProfileModule,
    FarmsModule,
    ParcelDailyStatusModule,
    DeliveryDestinationsModule,
    NotificationsModule,
    GeofenceModule,
    DepositInventoryModule,
    MobileLogsModule,
    UploadsModule,
    TripRequestsModule,
    FleetModule,
    BeneficiariesModule,
    TransporterModule,
    ...devModules,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    /*
     * Third, and the order is load-bearing: FeaturesGuard reads
     * `request.user.disabledFeatures`, which AuthGuard sets. Declared here in
     * the root module's providers (not inside FeaturesModule) because
     * root-module APP_GUARDs run before those contributed by imported modules —
     * keeping all three in one list is what makes the sequence deterministic.
     */
    { provide: APP_GUARD, useClass: FeaturesGuard },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: UploadUrlSigningInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
