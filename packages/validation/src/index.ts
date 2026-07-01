// Helpers
export { uuidSchema } from './helpers/uuid.js';
export { isoDateSchema } from './helpers/iso-date.js';
export { geoPointSchema } from './helpers/geo.js';
export { timestampsSchema, softDeleteSchema } from './helpers/common.js';

// Entity schemas
export { createFarmSchema, updateFarmSchema } from './schemas/farm.schema.js';

export { createOrganizationSchema } from './schemas/organization.schema.js';
export type { CreateOrganizationInput } from './schemas/organization.schema.js';

export {
  userRoleSchema,
  userSchema,
  createUserSchema,
  updateUserSchema,
} from './schemas/user.schema.js';

export {
  updateProfileLocaleSchema,
  updateProfileSchema,
  changePasswordSchema,
} from './schemas/profile.schema.js';

export {
  parcelSchema,
  harvestStatusSchema,
  cropTypeSchema,
  createParcelSchema,
  updateParcelSchema,
  importParcelSchema,
  importParcelsSchema,
} from './schemas/parcel.schema.js';

export { overrideBalesSchema, transferToDepotSchema } from './schemas/parcel-bale.schema.js';

export {
  machineTypeSchema,
  fuelTypeSchema,
  machineSchema,
  createMachineSchema,
  updateMachineSchema,
} from './schemas/machine.schema.js';

export {
  tripStatusSchema,
  tripSchema,
  nextIterationDtoSchema,
  loaderRecallResponseSchema,
} from './schemas/trip.schema.js';

export { baleLoadSchema, createBaleLoadSchema } from './schemas/bale-load.schema.js';

export {
  baleProductionSchema,
  createBaleProductionSchema,
} from './schemas/bale-production.schema.js';

export {
  fuelLogSchema,
  createFuelLogSchema,
  updateFuelLogSchema,
} from './schemas/fuel-log.schema.js';

export {
  consumableTypeSchema,
  consumableLogSchema,
  createConsumableLogSchema,
} from './schemas/consumable-log.schema.js';

export {
  deliveryDestinationSchema,
  createDeliveryDestinationSchema,
  updateDeliveryDestinationSchema,
} from './schemas/delivery-destination.schema.js';

export {
  documentTypeSchema,
  documentStatusSchema,
  documentSchema,
} from './schemas/document.schema.js';

export {
  alertCategorySchema,
  alertSeveritySchema,
  alertSchema,
  createAlertSchema,
} from './schemas/alert.schema.js';

export { auditOperationSchema, auditLogSchema } from './schemas/audit-log.schema.js';

export {
  assignmentPrioritySchema,
  assignmentStatusSchema,
  taskAssignmentSchema,
  createTaskAssignmentSchema,
  updateAssignmentStatusSchema,
  updateTaskAssignmentSchema,
} from './schemas/task-assignment.schema.js';

export {
  parcelDailyStatusSchema,
  upsertParcelDailyStatusSchema,
} from './schemas/parcel-daily-status.schema.js';

export {
  portalCodeSchema,
  createTripRequestSchema,
  createBeneficiaryRequestSchema,
  verifyPortalCodeSchema,
  signTripSchema,
  updateOrgRequestSettingsSchema,
  confirmTripRequestSchema,
  cancelTripRequestSchema,
} from './schemas/trip-request.schema.js';
export type {
  CreateTripRequestInput,
  CreateBeneficiaryRequestInput,
  VerifyPortalCodeInput,
  SignTripInput,
  UpdateOrgRequestSettingsInput,
} from './schemas/trip-request.schema.js';

export {
  createBeneficiarySchema,
  updateBeneficiarySchema,
  verifyBeneficiaryPinSchema,
} from './schemas/beneficiary.schema.js';
export type {
  CreateBeneficiaryInput,
  UpdateBeneficiaryInput,
  VerifyBeneficiaryPinInput,
} from './schemas/beneficiary.schema.js';

export {
  portalPinSchema,
  createBeneficiaryContactSchema,
  updateBeneficiaryContactSchema,
  createBeneficiaryTruckSchema,
  updateBeneficiaryTruckSchema,
  createBeneficiaryDriverSchema,
  updateBeneficiaryDriverSchema,
} from './schemas/beneficiary-records.schema.js';
export type {
  CreateBeneficiaryContactInput,
  UpdateBeneficiaryContactInput,
  CreateBeneficiaryTruckInput,
  UpdateBeneficiaryTruckInput,
  CreateBeneficiaryDriverInput,
  UpdateBeneficiaryDriverInput,
} from './schemas/beneficiary-records.schema.js';

// DTO schemas
export { tripCreateDtoSchema } from './dtos/trip-create.schema.js';

export {
  startLoadingSchema,
  completeLoadingSchema,
  departSchema,
  arriveSchema,
  startDeliverySchema,
  confirmDeliverySchema,
  confirmDepotDeliverySchema,
  completeSchema,
  cancelSchema,
  forceStatusSchema,
  disputeSchema,
  resolveDisputeSchema,
  registerLoadSchema,
} from './dtos/trip-transition.schema.js';

export {
  syncMutationSchema,
  syncPushRequestSchema,
  syncPullRequestSchema,
} from './dtos/sync-payload.schema.js';

export {
  mobileLogEntrySchema,
  mobileLogIngestSchema,
  type MobileLogIngestDto,
  type MobileLogEntryDto,
} from './schemas/mobile-log-ingest.schema.js';

export {
  broadcastNotificationSchema,
  type BroadcastNotificationDto,
} from './schemas/mobile-notification.schema.js';

export {
  otaStateSchema,
  releaseStatusSchema,
  otaTargetKindSchema,
  deviceOtaReportSchema,
  deviceCommandReportSchema,
  remoteCommandTypeSchema,
  deviceRemoteCommandReportSchema,
  createRemoteCommandSchema,
  type CreateRemoteCommandInput,
  deviceCheckinSchema,
  createReleaseSchema,
  updateReleaseSchema,
  createDeploymentSchema,
  updateDeviceSchema,
  setDeviceTailscaleSchema,
  updateTailscaleSettingsSchema,
  type DeviceCheckinInput,
  type CreateReleaseInput,
  type UpdateReleaseInput,
  type CreateDeploymentInput,
  type UpdateDeviceInput,
  type SetDeviceTailscaleInput,
  type UpdateTailscaleSettingsInput,
} from './schemas/fleet.schema.js';

export {
  adminSimulatePushSchema,
  type AdminSimulatePushDto,
} from './schemas/admin-simulate-push.schema.js';

export {
  dashboardOverviewSchema,
  productionReportSchema,
  costReportSchema,
  antiFraudReportSchema,
} from './dtos/dashboard.schema.js';

export {
  fieldReportSchema,
  farmReportSchema,
  depotReportSchema,
  reportTimelinePointSchema,
  reportQuerySchema,
  truckDistanceQuerySchema,
  operatorDistanceQuerySchema,
  connectedHoursQuerySchema,
  connectedHoursRowSchema,
  connectedHoursReportSchema,
} from './dtos/reports.schema.js';
export type {
  ReportQuery,
  TruckDistanceQuery,
  OperatorDistanceQuery,
  ConnectedHoursQuery,
} from './dtos/reports.schema.js';
