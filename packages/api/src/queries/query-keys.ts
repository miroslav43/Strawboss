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
    byMachineType: (date: string, machineType: string) => ['taskAssignments', 'byMachineType', date, machineType] as const,
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
    production: (filters?: Record<string, unknown>) => ['dashboard', 'production', filters] as const,
    costs: (filters?: Record<string, unknown>) => ['dashboard', 'costs', filters] as const,
    antiFraud: () => ['dashboard', 'antiFraud'] as const,
    trending: () => ['dashboard', 'trending'] as const,
  },
  location: {
    machines: () => ['location', 'machines'] as const,
    route: (machineId: string, from: string, to: string) => ['location', 'route', machineId, from, to] as const,
    related: () => ['location', 'related-machines'] as const,
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
  },
  farms: {
    all:    ['farms'] as const,
    list:   (filters?: Record<string, unknown>) => ['farms', 'list', filters] as const,
    detail: (id: string) => ['farms', 'detail', id] as const,
  },
  deliveryDestinations: {
    all: ['deliveryDestinations'] as const,
    list: (filters?: Record<string, unknown>) => ['deliveryDestinations', 'list', filters] as const,
    detail: (id: string) => ['deliveryDestinations', 'detail', id] as const,
  },
} as const;
