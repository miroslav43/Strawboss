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
  ],
})
export class AppModule {}
