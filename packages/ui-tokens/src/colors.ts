export const colors = {
  primary: '#0A5C36',
  secondary: '#1E8449',
  tertiary: '#8D6E63',
  neutral: '#5D4037',
  background: '#F3DED8',
  surface: '#EED9D2',
  danger: '#C62828',
  warning: '#B7791F',
  success: '#2E7D32',
  info: '#1565C0',
  white: '#FFFFFF',
  black: '#000000',
  // Accessible secondary text — contrast ≥4.5:1 on background (#F3DED8)
  textSecondary: '#4A3728',
  // Shades for primary
  primary50: '#E8F5E9',
  primary100: '#C8E6C9',
  primary200: '#A5D6A7',
  primary300: '#81C784',
  primary400: '#66BB6A',
  primary500: '#0A5C36',
  primary600: '#094E2E',
  primary700: '#074024',
  primary800: '#05321B',
  primary900: '#032411',
  // Neutral shades
  neutral50: '#EFEBE9',
  neutral100: '#D7CCC8',
  neutral200: '#BCAAA4',
  neutral300: '#A1887F',
  neutral400: '#8D6E63',
  neutral500: '#5D4037',
  neutral600: '#4E342E',
  neutral700: '#3E2723',
  neutral800: '#2C1B14',
  neutral900: '#1A0F0B',
  // Mobile map: parcels assigned to the logged-in operator today. Mirrored
  // literally (not imported — the map runs inside a WebView, not the RN
  // bundle) in apps/mobile/src/map/leaflet-map-content.ts getParcelStyle().
  // Kept here so the legend chip on the map screen (rendered in RN, not the
  // WebView) can consume a token instead of a bare hex.
  mapAssigned: '#A855F7',
  mapAssignedFill: '#7C3AED',
} as const;

/**
 * High-contrast palette for "Mod lumină puternică" (FM-8).
 *
 * Design goals:
 *  - Pure white background (contrast with dark text > 15:1)
 *  - Black / very dark text for all body copy
 *  - Buttons retain solid borders so they remain visible without fill
 *  - Primary action color darkened to #084A2B (≥ 4.5:1 on white)
 *
 * Components that consume the theme via `useTheme()` can switch between
 * `colors` (default) and `colorsHighContrast` at runtime.
 */
export const colorsHighContrast = {
  primary: '#084A2B',
  secondary: '#155D35',
  tertiary: '#3E2723',
  neutral: '#1A0F0B',
  background: '#FFFFFF',
  surface: '#F5F5F5',
  danger: '#B71C1C',
  warning: '#7B4F00',
  success: '#1B5E20',
  info: '#0D47A1',
  white: '#FFFFFF',
  black: '#000000',
  textSecondary: '#212121',
  primary50: '#E8F5E9',
  primary100: '#C8E6C9',
  primary200: '#A5D6A7',
  primary300: '#81C784',
  primary400: '#66BB6A',
  primary500: '#084A2B',
  primary600: '#063D23',
  primary700: '#04311B',
  primary800: '#032413',
  primary900: '#01180C',
  neutral50: '#FAFAFA',
  neutral100: '#F0F0F0',
  neutral200: '#D6D6D6',
  neutral300: '#B0B0B0',
  neutral400: '#757575',
  neutral500: '#212121',
  neutral600: '#1A1A1A',
  neutral700: '#141414',
  neutral800: '#0D0D0D',
  neutral900: '#070707',
  // See `colors.mapAssigned` — darker pair for the high-contrast palette.
  mapAssigned: '#6D28D9',
  mapAssignedFill: '#5B21B6',
} as const;

/** Union type covering both palette shapes. */
export type ColorPalette = typeof colors | typeof colorsHighContrast;
