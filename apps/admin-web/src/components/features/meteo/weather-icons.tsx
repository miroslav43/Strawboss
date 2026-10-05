import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudHail,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudRainWind,
  CloudSnow,
  CloudSun,
  Cloudy,
  Moon,
  Navigation,
  Snowflake,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import type { MeteoWeatherIcon } from '@strawboss/types';

/** Icon key (computed server-side from the WMO code + day/night) -> lucide icon. */
const ICONS: Record<MeteoWeatherIcon, LucideIcon> = {
  clear: Sun,
  clear_night: Moon,
  partly_cloudy: CloudSun,
  partly_cloudy_night: CloudMoon,
  overcast: Cloudy,
  fog: CloudFog,
  drizzle: CloudDrizzle,
  freezing_drizzle: CloudSnow,
  rain: CloudRain,
  heavy_rain: CloudRainWind,
  freezing_rain: CloudSnow,
  snow: Snowflake,
  showers: CloudRain,
  snow_showers: CloudSnow,
  thunderstorm: CloudLightning,
  thunderstorm_hail: CloudHail,
  unknown: Cloud,
};

/** Tailwind text colour per icon family, so a row of icons reads at a glance. */
const TINTS: Record<MeteoWeatherIcon, string> = {
  clear: 'text-amber-500',
  clear_night: 'text-indigo-400',
  partly_cloudy: 'text-amber-500',
  partly_cloudy_night: 'text-indigo-400',
  overcast: 'text-slate-400',
  fog: 'text-slate-400',
  drizzle: 'text-sky-500',
  freezing_drizzle: 'text-cyan-500',
  rain: 'text-sky-600',
  heavy_rain: 'text-blue-700',
  freezing_rain: 'text-cyan-600',
  snow: 'text-cyan-500',
  showers: 'text-sky-600',
  snow_showers: 'text-cyan-500',
  thunderstorm: 'text-violet-600',
  thunderstorm_hail: 'text-violet-700',
  unknown: 'text-neutral-400',
};

export function WeatherIcon({
  icon,
  className = 'h-6 w-6',
  tinted = true,
}: {
  icon: MeteoWeatherIcon;
  className?: string;
  tinted?: boolean;
}) {
  const Cmp = ICONS[icon] ?? Cloud;
  return <Cmp className={`${className} ${tinted ? (TINTS[icon] ?? '') : ''}`} aria-hidden="true" />;
}

/**
 * Wind direction arrow. `deg` is the METEOROLOGICAL direction (where the wind
 * comes FROM); the arrow points where it blows TO, hence +180.
 */
export function WindArrow({ deg, className = 'h-3.5 w-3.5' }: { deg: number | null; className?: string }) {
  if (deg === null || !Number.isFinite(deg)) return null;
  return (
    <Navigation
      className={className}
      style={{ transform: `rotate(${Math.round(deg + 180)}deg)` }}
      aria-hidden="true"
    />
  );
}
