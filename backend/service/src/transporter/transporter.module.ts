import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { TripRequestsModule } from '../trip-requests/trip-requests.module';
import { CmrScansModule } from '../cmr-scans/cmr-scans.module';
import { DocumentsModule } from '../documents/documents.module';
import { TransporterController } from './transporter.controller';
import { TransporterAdminController } from './transporter-admin.controller';
import { TransporterAssignmentsService } from './transporter-assignments.service';

/**
 * The `transportator` (external hauler) web surface: their assigned beneficiaries,
 * saved-record CRUD, request submission, and read-only ledger — plus the admin
 * endpoints to manage a transporter's beneficiary assignments.
 *
 * Reuses TripRequestsService (submit + ledger) and BeneficiaryRecordsService (saved
 * records), both exported from TripRequestsModule.
 */
@Module({
  imports: [DatabaseModule, TripRequestsModule, CmrScansModule, DocumentsModule],
  controllers: [TransporterController, TransporterAdminController],
  providers: [TransporterAssignmentsService],
})
export class TransporterModule {}
