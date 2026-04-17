import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AppLoggerModule } from './logger/logger.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
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
import { AlertsModule } from './alerts/alerts.module';
import { AuditModule } from './audit/audit.module';
import { SyncModule } from './sync/sync.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { LocationModule } from './location/location.module';
import { AdminUsersModule } from './admin-users/admin-users.module';
import { DashboardModule } from './dashboard/dashboard.module';
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

@Module({
  imports: [
    AppLoggerModule,
    HealthModule,
    ConfigModule,
    DatabaseModule,
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
    AlertsModule,
    AuditModule,
    SyncModule,
    ReconciliationModule,
    LocationModule,
    AdminUsersModule,
    DashboardModule,
    JobsModule,
    TrpcModule,
    ProfileModule,
    FarmsModule,
    ParcelDailyStatusModule,
    DeliveryDestinationsModule,
    NotificationsModule,
    GeofenceModule,
    MobileLogsModule,
    UploadsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
