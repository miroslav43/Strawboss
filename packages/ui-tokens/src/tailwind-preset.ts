import { colors } from './colors.js';
import { spacing } from './spacing.js';
import { fontFamilies, fontSizes, fontWeights, lineHeights } from './typography.js';

// Convert numeric spacing to rem/px strings for Tailwind
const spacingTailwind = Object.fromEntries(
  Object.entries(spacing).map(([k, v]) => [k, `${v}px`])
);

// Convert numeric fontSizes to rem strings
const fontSizesTailwind = Object.fromEntries(
  Object.entries(fontSizes).map(([k, v]) => [k, `${v / 16}rem`])
);

export const strawbossPreset = {
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: colors.primary, 50: colors.primary50, 100: colors.primary100, 200: colors.primary200, 300: colors.primary300, 400: colors.primary400, 500: colors.primary500, 600: colors.primary600, 700: colors.primary700, 800: colors.primary800, 900: colors.primary900 },
        secondary: { DEFAULT: colors.secondary },
        tertiary: { DEFAULT: colors.tertiary },
        neutral: { DEFAULT: colors.neutral, 50: colors.neutral50, 100: colors.neutral100, 200: colors.neutral200, 300: colors.neutral300, 400: colors.neutral400, 500: colors.neutral500, 600: colors.neutral600, 700: colors.neutral700, 800: colors.neutral800, 900: colors.neutral900 },
        background: colors.background,
        surface: colors.surface,
        danger: { DEFAULT: colors.danger },
        warning: { DEFAULT: colors.warning },
        success: { DEFAULT: colors.success },
        info: { DEFAULT: colors.info },
      },
      spacing: spacingTailwind,
      fontFamily: { sans: [fontFamilies.sans], mono: [fontFamilies.mono] },
      fontSize: fontSizesTailwind,
      fontWeight: fontWeights,
      lineHeight: Object.fromEntries(
        Object.entries(lineHeights).map(([k, v]) => [k, String(v)])
      ),
    },
  },
} as const;
