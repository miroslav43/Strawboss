export interface StartLoadingDto {
  loaderId?: string;
  loaderOperatorId: string;
}

export interface CompleteLoadingDto {}

export interface DepartDto {
  departureOdometerKm: number;
}

export interface ArriveDto {
  arrivalOdometerKm: number;
}

export interface StartDeliveryDto {
  destinationName?: string;
}

export interface ConfirmDeliveryDto {
  grossWeightKg: number;
  weightTicketNumber?: string;
}

export interface CompleteDto {
  receiverName: string;
  receiverSignature: string;
}

export interface CancelDto {
  cancellationReason: string;
}

export interface DisputeDto {
  reason: string;
}

export interface ResolveDisputeDto {
  resolutionNotes: string;
  resolvedTo: 'delivered' | 'completed';
}
