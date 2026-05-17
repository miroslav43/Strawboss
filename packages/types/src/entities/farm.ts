export enum FarmEntityType {
  persoana_juridica = "persoana_juridica",
  persoana_fizica   = "persoana_fizica",
}

export interface Farm {
  id: string;
  name: string;
  phone: string | null;
  entityType: FarmEntityType | null;
  cui: string | null;
  apiaCode: string | null;
  address: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
