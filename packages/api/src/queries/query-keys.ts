export const queryKeys = {
  trips: {
    all: ['trips'] as const,
    list: (filters?: Record<string, unknown>) => ['trips', 'list', filters] as const,
    detail: (id: string) => ['trips', 'detail', id] as const,
  },
  parcels: {
    all: ['parcels'] as const,
    list: (filters?: Record<string, unknown>) => ['parcels', 'list', filters] as const,
    detail: (id: string) => ['parcels', 'detail', id] as const,
    baleAvailability: (id: string) => ['parcels', 'bale-availability', id] as const,
  },
  machines: {
    all: ['machines'] as const,
    list: (filters?: Record<string, unknown>) => ['machines', 'list', filters] as const,
    detail: (id: string) => ['machines', 'detail', id] as const,
  },
  taskAssignments: {
    all: ['taskAssignments'] as const,
    list: (filters?: Record<string, unknown>) => ['taskAssignments', 'list', filters] as const,
    byDate: (date: string) => ['taskAssignments', 'date', date] as const,
    dailyPlan: (date: string) => ['taskAssignments', 'dailyPlan', date] as const,
    byMachineType: (date: string, machineType: string) =>
      ['taskAssignments', 'byMachineType', date, machineType] as const,
  },
  parcelDailyStatus: {
    all: ['parcelDailyStatus'] as const,
    byDate: (date: string) => ['parcelDailyStatus', 'date', date] as const,
  },
  baleLoads: {
    all: ['baleLoads'] as const,
    byTrip: (tripId: string) => ['baleLoads', 'trip', tripId] as const,
  },
  fuelLogs: {
    all: ['fuelLogs'] as const,
    byMachine: (machineId: string) => ['fuelLogs', 'machine', machineId] as const,
    adminList: (from: string, to: string) => ['fuelLogs', 'admin-list', from, to] as const,
    list: (filters?: Record<string, unknown>) => ['fuelLogs', 'list', filters] as const,
  },
  consumableLogs: {
    all: ['consumableLogs'] as const,
    byMachine: (machineId: string) => ['consumableLogs', 'machine', machineId] as const,
    adminList: (from: string, to: string) => ['consumableLogs', 'admin-list', from, to] as const,
  },
  documents: {
    all: ['documents'] as const,
    byTrip: (tripId: string) => ['documents', 'trip', tripId] as const,
    detail: (id: string) => ['documents', 'detail', id] as const,
  },
  alerts: {
    all: ['alerts'] as const,
    list: (filters?: Record<string, unknown>) => ['alerts', 'list', filters] as const,
    unacknowledged: () => ['alerts', 'unacknowledged'] as const,
  },
  dashboard: {
    overview: () => ['dashboard', 'overview'] as const,
    production: (filters?: Record<string, unknown>) =>
      ['dashboard', 'production', filters] as const,
    costs: (filters?: Record<string, unknown>) => ['dashboard', 'costs', filters] as const,
    antiFraud: () => ['dashboard', 'antiFraud'] as const,
    trending: () => ['dashboard', 'trending'] as const,
  },
  location: {
    machines: () => ['location', 'machines'] as const,
    route: (machineId: string, from: string, to: string) =>
      ['location', 'route', machineId, from, to] as const,
    related: () => ['location', 'related-machines'] as const,
    trucksAtLoader: (loaderMachineId: string) =>
      ['location', 'trucks-at-loader', loaderMachineId] as const,
    kmByDay: (machineId: string, from: string, to: string) =>
      ['location', 'km-by-day', machineId, from, to] as const,
  },
  auth: {
    session: () => ['auth', 'session'] as const,
  },
  sync: {
    status: () => ['sync', 'status'] as const,
  },
  baleProductions: {
    all: ['baleProductions'] as const,
    list: (filters?: Record<string, unknown>) => ['baleProductions', 'list', filters] as const,
    byOperator: (operatorId: string) => ['baleProductions', 'operator', operatorId] as const,
    stats: (filters?: Record<string, unknown>) => ['baleProductions', 'stats', filters] as const,
    machineStats: (filters?: Record<string, unknown>) =>
      ['baleProductions', 'machineStats', filters] as const,
  },
  farms: {
    all: ['farms'] as const,
    list: (filters?: Record<string, unknown>) => ['farms', 'list', filters] as const,
    detail: (id: string) => ['farms', 'detail', id] as const,
  },
  deliveryDestinations: {
    all: ['deliveryDestinations'] as const,
    list: (filters?: Record<string, unknown>) => ['deliveryDestinations', 'list', filters] as const,
    detail: (id: string) => ['deliveryDestinations', 'detail', id] as const,
  },
  depotInventory: {
    all: ['deposit-inventory'] as const,
    detail: (depotId: string) => ['deposit-inventory', depotId] as const,
  },
  tripRequests: {
    all: ['tripRequests'] as const,
    list: (filters?: Record<string, unknown>) => ['tripRequests', 'list', filters] as const,
    detail: (id: string) => ['tripRequests', 'detail', id] as const,
  },
  orgRequestSettings: {
    all: ['orgRequestSettings'] as const,
  },
  messages: {
    all: ['messages'] as const,
    list: (filters?: Record<string, unknown>) => ['messages', 'list', filters] as const,
    superAdminList: (filters?: Record<string, unknown>) =>
      ['messages', 'superAdmin', 'list', filters] as const,
  },
  beneficiaries: {
    all: ['beneficiaries'] as const,
    list: () => ['beneficiaries', 'list'] as const,
    detail: (id: string) => ['beneficiaries', 'detail', id] as const,
  },
  devices: {
    all: ['devices'] as const,
    list: (filters?: Record<string, unknown>) => ['devices', 'list', filters] as const,
    detail: (id: string) => ['devices', 'detail', id] as const,
    otaStatus: (id: string) => ['devices', 'otaStatus', id] as const,
    logs: (id: string, filters?: Record<string, unknown>) =>
      ['devices', 'logs', id, filters] as const,
    commands: (id: string) => ['devices', 'commands', id] as const,
    uptime: (id: string, days: number) => ['devices', 'uptime', id, days] as const,
    messages: (id: string) => ['devices', 'messages', id] as const,
  },
  releases: {
    all: ['releases'] as const,
  },
  deployments: {
    all: ['deployments'] as const,
  },
  settings: {
    tailscale: () => ['super-admin', 'settings', 'tailscale'] as const,
  },
  reports: {
    all: ['reports'] as const,
    farms: (filters?: Record<string, unknown>) => ['reports', 'farms', filters] as const,
    depots: (filters?: Record<string, unknown>) => ['reports', 'depots', filters] as const,
    timeline: (filters?: Record<string, unknown>) => ['reports', 'timeline', filters] as const,
    truckDistance: (filters?: Record<string, unknown>) =>
      ['reports', 'truckDistance', filters] as const,
    truckDistanceSummary: () => ['reports', 'truckDistanceSummary'] as const,
    operatorDistance: (filters?: Record<string, unknown>) =>
      ['reports', 'operatorDistance', filters] as const,
    connectedHours: (filters?: Record<string, unknown>) =>
      ['reports', 'connectedHours', filters] as const,
  },
} as const;
