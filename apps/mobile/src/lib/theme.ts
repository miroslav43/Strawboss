/**
 * FM-8: Runtime theme helper.
 *
 * Returns the active color palette based on the persisted `highContrast`
 * preference in `useThemeStore`. Import `useTheme()` in any component that
 * needs to adapt to the "Mod lumină puternică" toggle.
 *
 * Usage:
 *   const { colors } = useTheme();
 *   // `colors` is either the default palette or `colorsHighContrast`
 */
import { colors, colorsHighContrast, type ColorPalette } from '@strawboss/ui-tokens';
import { useThemeStore } from '@/stores/theme-store';

export interface ThemeResult {
  /** The active color palette (default or high-contrast). */
  colors: ColorPalette;
  /** True when the high-contrast mode is active. */
  highContrast: boolean;
}

/**
 * Hook that returns the active theme palette.
 * Re-renders automatically whenever the user toggles the preference.
 */
export function useTheme(): ThemeResult {
  const highContrast = useThemeStore((s) => s.highContrast);
  return {
    colors: highContrast ? colorsHighContrast : colors,
    highContrast,
  };
}
