import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { ParcelsModule } from './parcels/parcels.module';
import { MachinesModule } from './machines/machines.module';
import { TaskAssignmentsModule } from './task-assignments/task-assignments.module';
import { TripsModule } from './trips/trips.module';
import { BaleLoadsModule } from './bale-loads/bale-loads.module';
import { FuelLogsModule } from './fuel-logs/fuel-logs.module';
import { ConsumableLogsModule } from './consumable-logs/consumable-logs.module';
import { DocumentsModule } from './documents/documents.module';
import { AlertsModule } from './alerts/alerts.module';
import { AuditModule } from './audit/audit.module';
import { SyncModule } from './sync/sync.module';
import { FarmTrackModule } from './farmtrack/farmtrack.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { JobsModule } from './jobs/jobs.module';
import { TrpcModule } from './trpc/trpc.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    AuthModule,
    ParcelsModule,
    MachinesModule,
    TaskAssignmentsModule,
    TripsModule,
    BaleLoadsModule,
    FuelLogsModule,
    ConsumableLogsModule,
    DocumentsModule,
    AlertsModule,
    AuditModule,
    SyncModule,
    FarmTrackModule,
    ReconciliationModule,
    DashboardModule,
    JobsModule,
    TrpcModule,
  ],
})
export class AppModule {}
