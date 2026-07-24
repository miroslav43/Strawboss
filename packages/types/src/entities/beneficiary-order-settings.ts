/**
 * Per-beneficiary "comandă" (transport order) settings — the fields of the order
 * that are constant for a beneficiary and don't exist on a trip. A transporter
 * fills these once per assigned beneficiary (Beneficiari tab); the comandă
 * generator merges them with the request data. Singleton per beneficiary.
 */
export interface BeneficiaryOrderSettings {
  id: string;
  organizationId: string;
  beneficiaryId: string;
  /** "Valoare transport" amount, e.g. 680. */
  transportValue: number | null;
  /** ISO-4217-ish currency label rendered next to the value, e.g. "EUR". */
  currency: string;
  /** "OP la {N} de zile de la primirea actelor în original". */
  paymentTermDays: number;
  /** Standard number of bales for this beneficiary, e.g. 33. */
  baleCount: number | null;
  /** Bale dimensions string, e.g. "240X120X90". */
  baleDimensions: string | null;
  /** Goods label, e.g. "PAIE" → "{baleCount} BALOTI {goodsName}, {baleDimensions}". */
  goodsName: string | null;
  /** Truck description, e.g. "CAMION CU REMORCA MEGA/VARIO". */
  truckDescription: string | null;
  /** Loading place, e.g. "TIMIS" / "RO" → "Încărcare: {locality}, {country}, {date}". */
  loadingLocality: string | null;
  loadingCountry: string | null;
  /** OBS line, e.g. "Actele în original se vor trimite la adresa: NU". */
  obs: string | null;
  /** Per-beneficiary running order counter; the next comandă is orderCounter + 1. */
  orderCounter: number;
  createdAt: string;
  updatedAt: string;
}
