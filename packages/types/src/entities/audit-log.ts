export enum AuditOperation {
  insert = "insert",
  update = "update",
  delete = "delete",
}

export interface AuditLog {
  id: string;
  tableName: string;
  recordId: string;
  operation: AuditOperation;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  changedFields: string[] | null;
  userId: string | null;
  clientId: string | null;
  ipAddress: string | null;
  createdAt: string;
}
