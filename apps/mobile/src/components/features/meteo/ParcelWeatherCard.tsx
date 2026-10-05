/**
 * Compact weather card for the parcel detail screen.
 *
 * Live data comes from the server's compact weather view (fetched only when the
 * `meteo.forecast` gate is open and the phone is online). Every successful
 * answer is mirrored into the local `app_state` key/value table under
 * `meteo_wx:<parcelId>` so the card still shows the last value offline. Renders
 * nothing when there is neither a live answer nor a cached copy.
 */

import { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useMeteoParcelWeather } from '@strawboss/api';
import type { MeteoParcelWeatherCompact, MeteoWeatherIcon } from '@strawboss/types';
import { mobileApiClient } from '@/lib/api-client';
import { getDatabase } from '@/lib/storage';
import { mobileLogger } from '@/lib/logger';
import { dateLocaleFor, useI18n } from '@/lib/i18n';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useMeteoWeatherAvailable } from '@/hooks/useMeteoWeatherAvailable';

const KEY_PREFIX = 'meteo_wx:';
const MAX_CACHED = 20;

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

const ICONS: Record<MeteoWeatherIcon, IconName> = {
  clear: 'weather-sunny',
  clear_night: 'weather-night',
  partly_cloudy: 'weather-partly-cloudy',
  partly_cloudy_night: 'weather-night-partly-cloudy',
  overcast: 'weather-cloudy',
  fog: 'weather-fog',
  drizzle: 'weather-rainy',
  freezing_drizzle: 'weather-snowy-rainy',
  rain: 'weather-rainy',
  heavy_rain: 'weather-pouring',
  freezing_rain: 'weather-snowy-rainy',
  snow: 'weather-snowy',
  showers: 'weather-pouring',
  snow_showers: 'weather-snowy',
  thunderstorm: 'weather-lightning',
  thunderstorm_hail: 'weather-hail',
  unknown: 'weather-cloudy',
};

interface CachedWeather {
  savedAt: string;
  payload: MeteoParcelWeatherCompact;
}

async function readCache(parcelId: string): Promise<CachedWeather | null> {
  try {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ value: string | null }>(
      'SELECT value FROM app_state WHERE key = ?',
      [KEY_PREFIX + parcelId],
    );
    if (!row?.value) return null;
    const parsed = JSON.parse(row.value) as CachedWeather;
    return parsed?.payload ? parsed : null;
  } catch {
    return null;
  }
}

async function writeCache(parcelId: string, payload: MeteoParcelWeatherCompact): Promise<void> {
  try {
    const db = await getDatabase();
    const value = JSON.stringify({ savedAt: new Date().toISOString(), payload });
    await db.runAsync(
      `INSERT OR REPLACE INTO app_state (key, value, updated_at) VALUES (?, ?, datetime('now'))`,
      [KEY_PREFIX + parcelId, value],
    );
    // Keep only the newest MAX_CACHED parcels.
    await db.runAsync(
      `DELETE FROM app_state WHERE key LIKE 'meteo_wx:%' AND key NOT IN (
         SELECT key FROM app_state WHERE key LIKE 'meteo_wx:%' ORDER BY updated_at DESC, key LIMIT ?
       )`,
      [MAX_CACHED],
    );
  } catch (e) {
    mobileLogger.warn('meteo weather cache write failed', { error: String(e) });
  }
}

const kmh = (ms: number | null): number | null => (ms == null ? null : Math.round(ms * 3.6));
const deg = (v: number | null): string => (v == null ? '—' : `${Math.round(v)}°`);

export function ParcelWeatherCard({ parcelId }: { parcelId: string }) {
  const { t, locale } = useI18n();
  const available = useMeteoWeatherAvailable();
  const { isConnected } = useNetworkStatus();
  const online = isConnected !== false;

  const cacheQuery = useQuery({
    queryKey: ['meteo-wx-cache', parcelId],
    queryFn: () => readCache(parcelId),
    networkMode: 'always',
    staleTime: Infinity,
  });

  const live = useMeteoParcelWeather(mobileApiClient, parcelId, 'compact', {
    enabled: available && online,
  });

  const liveData = live.data;
  useEffect(() => {
    if (liveData && liveData.current) void writeCache(parcelId, liveData);
  }, [parcelId, liveData]);

  const fromCache = !liveData;
  const cached = cacheQuery.data ?? null;
  const data = liveData ?? cached?.payload ?? null;
  if (!data || !data.current) return null;

  const stamp = liveData ? (liveData.fetchedAt ?? new Date().toISOString()) : cached?.savedAt;
  const time = stamp
    ? new Date(stamp).toLocaleTimeString(dateLocaleFor(locale), {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

  const cur = data.current;
  const wind = kmh(cur.windMs);
  const gust = kmh(cur.gustMs);
  const maxProb = data.next12h.reduce((m, h) => Math.max(m, h.precipProb ?? 0), 0);
  const frostLabel =
    data.frost === 'low'
      ? t('meteo.weather.frostLow')
      : data.frost === 'moderate'
        ? t('meteo.weather.frostModerate')
        : data.frost === 'high'
          ? t('meteo.weather.frostHigh')
          : null;
  const fmtHour = (iso: string) =>
    new Date(iso).toLocaleTimeString(dateLocaleFor(locale), { hour: '2-digit', minute: '2-digit' });

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t('meteo.weather.title')}</Text>

      <View style={styles.headRow}>
        <MaterialCommunityIcons name={ICONS[cur.icon] ?? 'weather-cloudy'} size={44} color="#0A5C36" />
        <View style={styles.headBody}>
          <Text style={styles.temp}>{cur.tempC != null ? `${Math.round(cur.tempC)}°C` : '—'}</Text>
          <Text style={styles.label}>{t(`meteo.wx.code.${cur.icon}`)}</Text>
        </View>
        {frostLabel && (
          <View style={styles.frostBadge}>
            <MaterialCommunityIcons name="snowflake-alert" size={14} color="#1D4ED8" />
            <Text style={styles.frostText}>
              {t('meteo.weather.frost')}: {frostLabel}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.chips}>
        <Text style={styles.chip}>
          {t('meteo.weather.wind')} {wind ?? '—'} km/h
        </Text>
        <Text style={styles.chip}>
          {t('meteo.weather.gust')} {gust ?? '—'} km/h
        </Text>
        <Text style={styles.chip}>
          {t('meteo.weather.rain24')} {data.rain24hMm != null ? data.rain24hMm.toFixed(1) : '—'} mm
          {' · '}
          {Math.round(maxProb * 100)}% {t('meteo.weather.prob')}
        </Text>
      </View>

      <Text style={styles.spray}>
        {t('meteo.weather.spray')}:{' '}
        {data.spray
          ? `${fmtHour(data.spray.start)} – ${fmtHour(data.spray.end)}`
          : t('meteo.weather.noSpray')}
      </Text>

      <View style={styles.days}>
        {data.days.slice(0, 3).map((d) => (
          <View key={d.date} style={styles.day}>
            <Text style={styles.dayName}>
              {new Date(`${d.date}T12:00:00`).toLocaleDateString(dateLocaleFor(locale), {
                weekday: 'short',
              })}
            </Text>
            <MaterialCommunityIcons name={ICONS[d.icon] ?? 'weather-cloudy'} size={24} color="#0A5C36" />
            <Text style={styles.dayTemp}>
              {deg(d.tMaxC)} / {deg(d.tMinC)}
            </Text>
            <Text style={styles.dayRain}>{d.precipMm != null ? `${d.precipMm.toFixed(1)} mm` : '—'}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.footer}>
        {t('meteo.weather.updated', { time })}
        {fromCache ? ` (${t('meteo.weather.cached')})` : liveData?.stale ? ` (${t('meteo.weather.stale')})` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  title: { fontSize: 13, fontWeight: '700', color: '#6B7280', textTransform: 'uppercase' },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headBody: { flex: 1 },
  temp: { fontSize: 28, fontWeight: '800', color: '#111827' },
  label: { fontSize: 14, color: '#4B5563' },
  frostBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#DBEAFE',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  frostText: { fontSize: 12, fontWeight: '700', color: '#1D4ED8' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    fontSize: 13,
    color: '#374151',
    backgroundColor: '#F3F4F6',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  spray: { fontSize: 14, color: '#374151' },
  days: { flexDirection: 'row', justifyContent: 'space-between' },
  day: { flex: 1, alignItems: 'center', gap: 2 },
  dayName: { fontSize: 12, fontWeight: '700', color: '#6B7280', textTransform: 'capitalize' },
  dayTemp: { fontSize: 13, fontWeight: '600', color: '#111827' },
  dayRain: { fontSize: 12, color: '#6B7280' },
  footer: { fontSize: 11, color: '#9CA3AF' },
});
