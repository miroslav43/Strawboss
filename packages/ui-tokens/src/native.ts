import { colors } from './colors.js';
import { spacing } from './spacing.js';
import { fontSizes, fontWeights, lineHeights } from './typography.js';

export const nativeColors = colors;
export const nativeSpacing = spacing;
export const nativeFontSizes = fontSizes;

export const nativeFontWeights = {
  normal: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
};

export const nativeLineHeights = Object.fromEntries(
  Object.entries(fontSizes).map(([k, size]) => [k, Math.round(size * lineHeights.normal)])
) as Record<keyof typeof fontSizes, number>;

// Convenience: common shadow styles
export const shadows = {
  sm: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  md: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 },
  lg: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 5 },
} as const;
