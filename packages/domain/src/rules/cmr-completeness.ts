export interface CmrCompletenessInput {
  tripNumber: string | null;
  sourceParcelName: string | null;
  destinationName: string | null;
  destinationAddress: string | null;
  driverName: string | null;
  truckRegistration: string | null;
  baleCount: number | null;
  grossWeightKg: number | null;
  netWeightKg: number | null;
  receiverName: string | null;
  receiverSignedAt: string | null;
  deliveredAt: string | null;
}

export interface CmrCompletenessResult {
  isComplete: boolean;
  missingFields: string[];
}

export function checkCmrCompleteness(
  input: CmrCompletenessInput,
): CmrCompletenessResult {
  const missingFields: string[] = [];

  const fields: Array<{ key: keyof CmrCompletenessInput; label: string }> = [
    { key: "tripNumber", label: "tripNumber" },
    { key: "sourceParcelName", label: "sourceParcelName" },
    { key: "destinationName", label: "destinationName" },
    { key: "destinationAddress", label: "destinationAddress" },
    { key: "driverName", label: "driverName" },
    { key: "truckRegistration", label: "truckRegistration" },
    { key: "baleCount", label: "baleCount" },
    { key: "grossWeightKg", label: "grossWeightKg" },
    { key: "netWeightKg", label: "netWeightKg" },
    { key: "receiverName", label: "receiverName" },
    { key: "receiverSignedAt", label: "receiverSignedAt" },
    { key: "deliveredAt", label: "deliveredAt" },
  ];

  for (const field of fields) {
    if (input[field.key] === null || input[field.key] === undefined) {
      missingFields.push(field.label);
    }
  }

  return {
    isComplete: missingFields.length === 0,
    missingFields,
  };
}
