export interface TrpcContext {
  user: { id: string; email: string; role: string } | null;
}
