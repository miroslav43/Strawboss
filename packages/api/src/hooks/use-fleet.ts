import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  Device,
  FleetDeviceListItem,
  AppRelease,
  OtaDeployment,
  DeviceOtaStatus,
  AppSettings,
  DeviceRemoteCommandRecord,
  RemoteCommandType,
  DeviceUptimeResponse,
} from '@strawboss/types';
import type {
  UpdateDeviceInput,
  UpdateReleaseInput,
  CreateDeploymentInput,
} from '@strawboss/validation';
import type { ApiClient } from '../client/api-client.js';
import { queryKeys } from '../queries/query-keys.js';

// ── Devices ───────────────────────────────────────────────────────────────────

export interface DeviceLogFilters extends Record<string, unknown> {
  level?: string;
  date?: string;
}

export interface DeviceLogEntry {
  level: string;
  message: string;
  context?: string;
  meta?: Record<string, unknown>;
  recordedAt?: string;
  timestamp?: string;
}

export interface DeviceLogResponse {
  entries: DeviceLogEntry[];
}

export interface DeviceOtaStatusWithVersion extends DeviceOtaStatus {
  version: string;
  versionCode: number;
}

/** Fleet device list — refetches every 20 s to stay fresh without Realtime. */
export function useDevices(client: ApiClient) {
  return useQuery({
    queryKey: queryKeys.devices.list(),
    queryFn: () => client.get<FleetDeviceListItem[]>('/api/v1/super-admin/devices'),
    refetchInterval: 20_000,
  });
}

export function useDevice(client: ApiClient, id: string) {
  return useQuery({
    queryKey: queryKeys.devices.detail(id),
    queryFn: () => client.get<Device>(`/api/v1/super-admin/devices/${id}`),
    enabled: !!id,
  });
}

/** Online/offline timeline + uptime % for a device over the last `days` (default 3). */
export function useDeviceUptime(
  client: ApiClient,
  id: string,
  options?: { days?: number; enabled?: boolean },
) {
  const days = options?.days ?? 3;
  return useQuery({
    queryKey: queryKeys.devices.uptime(id, days),
    queryFn: () =>
      client.get<DeviceUptimeResponse>(`/api/v1/super-admin/devices/${id}/uptime?days=${days}`),
    enabled: (options?.enabled ?? true) && !!id,
  });
}

export function useUpdateDevice(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateDeviceInput }) =>
      client.patch<Device>(`/api/v1/super-admin/devices/${id}`, data),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.devices.all });
      void queryClient.setQueryData(queryKeys.devices.detail(updated.id), updated);
    },
  });
}

export function useDeleteDevice(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.delete<{ ok: true }>(`/api/v1/super-admin/devices/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.devices.all });
    },
  });
}

/** Per-device OTA status timeline — refetches every 8 s when a detail view is open. */
export function useDeviceOtaStatus(client: ApiClient, id: string) {
  return useQuery({
    queryKey: queryKeys.devices.otaStatus(id),
    queryFn: () =>
      client.get<DeviceOtaStatusWithVersion[]>(`/api/v1/super-admin/devices/${id}/ota-status`),
    enabled: !!id,
    refetchInterval: 8_000,
  });
}

export function useDeviceLogs(client: ApiClient, id: string, filters: DeviceLogFilters = {}) {
  return useQuery({
    queryKey: queryKeys.devices.logs(id, filters),
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters.level) params.set('level', filters.level);
      if (filters.date) params.set('date', filters.date);
      const qs = params.toString();
      return client.get<DeviceLogResponse>(
        `/api/v1/super-admin/devices/${id}/logs${qs ? `?${qs}` : ''}`,
      );
    },
    enabled: !!id,
  });
}

// ── Releases ──────────────────────────────────────────────────────────────────

export function useReleases(client: ApiClient) {
  return useQuery({
    queryKey: queryKeys.releases.all,
    queryFn: () => client.get<AppRelease[]>('/api/v1/super-admin/releases'),
  });
}

export function useUploadRelease(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (formData: FormData) =>
      client.upload<AppRelease>('/api/v1/super-admin/releases', formData),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.releases.all });
    },
  });
}

export function useUpdateRelease(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateReleaseInput }) =>
      client.patch<AppRelease>(`/api/v1/super-admin/releases/${id}`, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.releases.all });
    },
  });
}

// ── Deployments ───────────────────────────────────────────────────────────────

export function useDeployments(client: ApiClient) {
  return useQuery({
    queryKey: queryKeys.deployments.all,
    queryFn: () => client.get<OtaDeployment[]>('/api/v1/super-admin/deployments'),
  });
}

export function useCreateDeployment(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateDeploymentInput) =>
      client.post<OtaDeployment>('/api/v1/super-admin/deployments', data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.deployments.all });
    },
  });
}

export function useCancelDeployment(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      client.post<{ ok: true }>(`/api/v1/super-admin/deployments/${id}/cancel`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.deployments.all });
    },
  });
}

// ── Tailscale ─────────────────────────────────────────────────────────────────

/** PATCH a device's desired Tailscale state (on/off). Invalidates the devices list + detail. */
export function useSetDeviceTailscale(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, desired }: { id: string; desired: boolean }) =>
      client.patch<Device>(`/api/v1/super-admin/devices/${id}/tailscale`, { desired }),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.devices.all });
      void queryClient.setQueryData(queryKeys.devices.detail(updated.id), updated);
    },
  });
}

// ── SMS gateway ─────────────────────────────────────────────────────────────

/** PATCH a device's SMS-gateway flag (on/off). Invalidates the devices list + detail. */
export function useSetDeviceSmsGateway(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      client.patch<Device>(`/api/v1/super-admin/devices/${id}/sms-gateway`, { enabled }),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.devices.all });
      void queryClient.setQueryData(queryKeys.devices.detail(updated.id), updated);
    },
  });
}

/** POST a one-off test SMS through the gateway device. `body` optional = custom text
 * (else a default test ping is sent). Invalidates device detail. */
export function useSendGatewayTestSms(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, to, body }: { id: string; to: string; body?: string }) =>
      client.post<{ ok: true; messageId: string }>(`/api/v1/super-admin/devices/${id}/test-sms`, {
        to,
        ...(body ? { body } : {}),
      }),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.devices.detail(id) });
    },
  });
}

/** GET the masked Tailscale settings. Returns the full AppSettings shape (no raw secrets). */
export function useTailscaleSettings(client: ApiClient) {
  return useQuery({
    queryKey: queryKeys.settings.tailscale(),
    queryFn: () => client.get<AppSettings>('/api/v1/super-admin/settings/tailscale'),
    refetchInterval: 60_000,
  });
}

export interface UpdateTailscaleSettingsInput {
  authKey?: string | null;
  tailnet?: string | null;
  oauthClientId?: string | null;
  oauthClientSecret?: string | null;
  tag?: string | null;
}

/** PUT Tailscale settings (authKey, tailnet, OAuth client, tag). Invalidates the settings cache. */
export function useUpdateTailscaleSettings(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateTailscaleSettingsInput) =>
      client.put<AppSettings>('/api/v1/super-admin/settings/tailscale', data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.tailscale() });
    },
  });
}

/**
 * POST a Tailscale APK file (multipart, field name `apk`).
 * Phones without Tailscale will install it automatically from this APK.
 * Invalidates the settings cache on success.
 */
export function useUploadTailscaleApk(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (formData: FormData) =>
      client.upload<AppSettings>('/api/v1/super-admin/settings/tailscale-apk', formData),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.tailscale() });
    },
  });
}

// ── Remote commands ───────────────────────────────────────────────────────────

export interface SendDeviceCommandInput {
  type: RemoteCommandType;
  params?: Record<string, unknown>;
}

/**
 * POST a one-shot remote-debug command to a device. The command is queued server-side
 * and delivered on the device's next check-in (≤60 s).
 * Invalidates device detail + command history on success.
 */
export function useSendDeviceCommand(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, command }: { id: string; command: SendDeviceCommandInput }) =>
      client.post<DeviceRemoteCommandRecord>(`/api/v1/super-admin/devices/${id}/commands`, command),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.devices.detail(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.devices.commands(id) });
    },
  });
}

/**
 * GET the command history for a device. Auto-refetches every 10 s so the status
 * column updates as the device processes queued commands.
 */
export function useDeviceCommands(client: ApiClient, id: string) {
  return useQuery({
    queryKey: queryKeys.devices.commands(id),
    queryFn: () =>
      client.get<DeviceRemoteCommandRecord[]>(`/api/v1/super-admin/devices/${id}/commands`),
    enabled: !!id,
    refetchInterval: 10_000,
  });
}

/**
 * POST to re-apply Tailscale on a single device (forces a fresh auth-key issue + tailscale up).
 * Invalidates device detail on success.
 */
export function useReapplyTailscale(client: ApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      client.post<{ ok: true }>(`/api/v1/super-admin/devices/${id}/reapply-tailscale`),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.devices.detail(id) });
    },
  });
}
