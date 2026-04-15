-- Push token storage for mobile notifications
CREATE TABLE device_push_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id),
  machine_id  UUID REFERENCES machines(id),
  token       TEXT NOT NULL,
  platform    TEXT NOT NULL DEFAULT 'android',
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, token)
);

-- Geofence entry/exit event log
CREATE TABLE geofence_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id        UUID NOT NULL REFERENCES machines(id),
  assignment_id     UUID REFERENCES task_assignments(id),
  geofence_type     TEXT NOT NULL,  -- 'parcel' or 'deposit'
  geofence_id       UUID NOT NULL,
  event_type        TEXT NOT NULL,  -- 'enter' or 'exit'
  lat               NUMERIC,
  lon               NUMERIC,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_geofence_events_machine ON geofence_events(machine_id, created_at DESC);
CREATE INDEX idx_geofence_events_assignment ON geofence_events(assignment_id);
CREATE INDEX idx_device_push_tokens_user ON device_push_tokens(user_id);
