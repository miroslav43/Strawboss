import type { MeteoWeatherIcon } from '@strawboss/types';

/**
 * WMO weather interpretation code (Open-Meteo `weather_code`) → icon key.
 * Computed server-side so neither the web nor the mobile app maps codes.
 */
export function weatherIcon(code: number | null, isDay: boolean | null): MeteoWeatherIcon {
  if (code === null || !Number.isFinite(code)) return 'unknown';
  const night = isDay === false;
  switch (code) {
    case 0:
      return night ? 'clear_night' : 'clear';
    case 1:
    case 2:
      return night ? 'partly_cloudy_night' : 'partly_cloudy';
    case 3:
      return 'overcast';
    case 45:
    case 48:
      return 'fog';
    case 51:
    case 53:
    case 55:
      return 'drizzle';
    case 56:
    case 57:
      return 'freezing_drizzle';
    case 61:
    case 63:
      return 'rain';
    case 65:
    case 82:
      return 'heavy_rain';
    case 66:
    case 67:
      return 'freezing_rain';
    case 71:
    case 73:
    case 75:
    case 77:
      return 'snow';
    case 80:
    case 81:
      return 'showers';
    case 85:
    case 86:
      return 'snow_showers';
    case 95:
      return 'thunderstorm';
    case 96:
    case 99:
      return 'thunderstorm_hail';
    default:
      return 'unknown';
  }
}
