export {
  useTrips,
  useTrip,
  useCreateTrip,
  useStartLoading,
  useCompleteLoading,
  useDepart,
  useArrive,
  useStartDelivery,
  useConfirmDelivery,
  useConfirmDepotDelivery,
  useCompleteTrip,
  useCancelTrip,
  useForceTripStatus,
  useDeleteTrip,
  useRegisterLoad,
} from './use-trips.js';

export { useTrucksAtLoader } from './use-trucks-at-loader.js';
export type { TruckAtLoader } from './use-trucks-at-loader.js';
export type { AssignedTruck, LoaderBoardResponse } from './use-trucks-at-loader.js';

export {
  useParcels,
  useParcel,
  useCreateParcel,
  useUpdateParcel,
  useUpdateParcelBoundary,
  useImportParcels,
  useDeleteParcel,
  useParcelBaleAvailability,
  useOverrideParcelBales,
  useTransferParcelToDepot,
} from './use-parcels.js';

export { useMachines, useMachine, useCreateMachine, useUpdateMachine } from './use-machines.js';

export {
  useTaskAssignments,
  useDailyPlan,
  useCreateTaskAssignment,
  useBulkCreateTaskAssignments,
  useAssignMachineToParcel,
  useUpdateAssignmentStatus,
  useAutoCompleteAssignments,
  useTasksByMachineType,
  useUpdateTaskAssignment,
  useDeleteTaskAssignment,
} from './use-task-assignments.js';

export {
  useParcelDailyStatuses,
  useUpsertParcelDailyStatus,
  useDeleteParcelDailyStatusForDate,
} from './use-parcel-daily-status.js';

export { useBaleLoads, useCreateBaleLoad } from './use-bale-loads.js';

export {
  useConsumableLogsList,
  useCreateConsumableLog,
  useUpdateConsumableLog,
  useDeleteConsumableLog,
} from './use-consumable-logs.js';
export type { ConsumableLogFilters } from './use-consumable-logs.js';

export {
  useFuelLogs,
  useCreateFuelLog,
  useFuelLogsList,
  useUpdateFuelLog,
  useDeleteFuelLog,
} from './use-fuel-logs.js';
export type { FuelLogFilters } from './use-fuel-logs.js';

export { useDocuments, useDocument, useGenerateCmr } from './use-documents.js';

export { useAlerts, useUnacknowledgedAlerts, useAcknowledgeAlert } from './use-alerts.js';

export {
  useTripRequests,
  useTripRequest,
  useConfirmTripRequest,
  useCancelTripRequest,
  useRequestAvize,
  useUploadAviz,
  useRequestCmrScans,
  useUploadCmrScan,
  useOrgRequestSettings,
  useUpdateOrgRequestSettings,
} from './use-trip-requests.js';
export type { DocVariant, CmrKind } from './use-trip-requests.js';

export {
  useMessages,
  useRetryMessage,
  useSuperAdminMessages,
  useRetrySuperAdminMessage,
  useDeviceMessages,
  type MessageFilters,
  type SuperAdminMessageFilters,
} from './use-messages.js';

export {
  useDashboardOverview,
  useDashboardTrending,
  useProductionReport,
  useCostReport,
  useAntiFraudReport,
} from './use-dashboard.js';
export type { TrendingDay, CostReportOptions } from './use-dashboard.js';

export { useSession, useLogin, useLogout } from './use-auth.js';

export { useSyncStatus, useSyncPush, useSyncPull } from './use-sync.js';

export type { SyncStatus } from './use-sync.js';

export {
  useAdminUsers,
  useCreateUser,
  useUpdateUser,
  useDeactivateUser,
  useUploadUserAvatar,
  useTransporterAssignments,
  useSetTransporterAssignments,
} from './use-admin-users.js';
export type { CreateUserPayload, UpdateUserPayload } from './use-admin-users.js';

export {
  useTransporterBeneficiaries,
  useTransporterRecords,
  useCreateTransporterRecord,
  useUpdateTransporterRecord,
  useDeleteTransporterRecord,
  useSubmitTransporterRequest,
  useTransporterRequests,
  useDeleteTransporterRequest,
  useBeneficiaryOrderSettings,
  useSaveBeneficiaryOrderSettings,
  useTransporterComanda,
  useGenerateTransporterComanda,
} from './use-transporter.js';
export type { AssignedBeneficiary, TransporterRecordKind } from './use-transporter.js';

export {
  useSuperAdminUsers,
  useCreateSuperAdminUser,
  useUpdateSuperAdminUser,
  useDeactivateSuperAdminUser,
} from './use-super-admin-users.js';

export { useMachineLocations } from './use-machine-locations.js';
export { useRouteHistory } from './use-route-history.js';
export { useLocationKmByDay } from './use-location-km-by-day.js';
export {
  useProfile,
  useUpdateProfileLocale,
  useUpdateProfile,
  useChangePassword,
  useUploadAvatar,
  useUploadSpecimen,
} from './use-profile.js';

export { useOrgFeatures, useUpdateOrgFeatures } from './use-org-features.js';
export type { OrgFeatureChange, OrgFeaturesResponse } from './use-org-features.js';

export {
  useBaleProductions,
  useBaleProductionStats,
  useMachineOperatorProduction,
  useCreateBaleProduction,
  useDeleteBaleProduction,
} from './use-bale-productions.js';
export type {
  BaleProductionFilters,
  BaleProductionStatsFilters,
  BaleProductionStatsOptions,
  MachineProductionFilters,
} from './use-bale-productions.js';

export {
  useDeliveryDestinations,
  useDeliveryDestination,
  useCreateDeliveryDestination,
  useUpdateDeliveryDestination,
  useDeleteDeliveryDestination,
} from './use-delivery-destinations.js';

export {
  useFarms,
  useFarm,
  useCreateFarm,
  useUpdateFarm,
  useDeleteFarm,
  useAssignParcelToFarm,
} from './use-farms.js';

export {
  useFarmReports,
  useDepotReports,
  useReportTimeline,
  useTruckDistanceReport,
  useTruckDistanceSummary,
  useOperatorDistanceReport,
  useUserConnectedHoursReport,
} from './use-reports.js';
export type {
  ReportQueryOptions,
  TruckDistanceFilters,
  OperatorDistanceFilters,
  ConnectedHoursFilters,
} from './use-reports.js';

export {
  useBeneficiaries,
  useCreateBeneficiary,
  useUpdateBeneficiary,
  useDeleteBeneficiary,
  useRegenBeneficiaryPin,
} from './use-beneficiaries.js';

export {
  useDevices,
  useDevice,
  useDeviceUptime,
  useUpdateDevice,
  useDeleteDevice,
  useDeviceOtaStatus,
  useDeviceLogs,
  useReleases,
  useUploadRelease,
  useUpdateRelease,
  useDeployments,
  useCreateDeployment,
  useCancelDeployment,
  useSetDeviceTailscale,
  useSetDeviceSmsGateway,
  useSendGatewayTestSms,
  useTailscaleSettings,
  useUpdateTailscaleSettings,
  useUploadTailscaleApk,
  useSendDeviceCommand,
  useDeviceCommands,
  useReapplyTailscale,
} from './use-fleet.js';
export type {
  DeviceLogFilters,
  DeviceLogEntry,
  DeviceLogResponse,
  DeviceOtaStatusWithVersion,
  UpdateTailscaleSettingsInput,
  SendDeviceCommandInput,
} from './use-fleet.js';
