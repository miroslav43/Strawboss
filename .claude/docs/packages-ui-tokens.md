# @strawboss/ui-tokens

Design tokens for the Strawboss visual identity. Exports raw values, a Tailwind CSS preset for `admin-web`, and React Native helpers for `mobile`.

**Source:** `packages/ui-tokens/src/`

## Colors (`colors.ts`)

Earthy agricultural palette:

### Core Colors

| Token | Hex | Usage |
|---|---|---|
| `primary` | `#0A5C36` | Primary brand green |
| `secondary` | `#1E8449` | Secondary green |
| `tertiary` | `#8D6E63` | Warm brown accent |
| `neutral` | `#5D4037` | Dark brown text |
| `background` | `#F3DED8` | Page background (warm peach) |
| `surface` | `#EED9D2` | Card/panel background |
| `danger` | `#C62828` | Errors, destructive actions |
| `warning` | `#B7791F` | Warnings, alerts |
| `success` | `#2E7D32` | Confirmations |
| `info` | `#1565C0` | Informational |
| `white` | `#FFFFFF` | |
| `black` | `#000000` | |

### Primary Shades (50-900)

| Token | Hex |
|---|---|
| `primary50` | `#E8F5E9` |
| `primary100` | `#C8E6C9` |
| `primary200` | `#A5D6A7` |
| `primary300` | `#81C784` |
| `primary400` | `#66BB6A` |
| `primary500` | `#0A5C36` |
| `primary600` | `#094E2E` |
| `primary700` | `#074024` |
| `primary800` | `#05321B` |
| `primary900` | `#032411` |

### Neutral Shades (50-900)

| Token | Hex |
|---|---|
| `neutral50` | `#EFEBE9` |
| `neutral100` | `#D7CCC8` |
| `neutral200` | `#BCAAA4` |
| `neutral300` | `#A1887F` |
| `neutral400` | `#8D6E63` |
| `neutral500` | `#5D4037` |
| `neutral600` | `#4E342E` |
| `neutral700` | `#3E2723` |
| `neutral800` | `#2C1B14` |
| `neutral900` | `#1A0F0B` |

## Spacing (`spacing.ts`)

4px base scale, numeric values (pixels for RN, converted to px strings for Tailwind):

| Token | Value |
|---|---|
| `xs` | 4 |
| `sm` | 8 |
| `md` | 12 |
| `lg` | 16 |
| `xl` | 24 |
| `2xl` | 32 |
| `3xl` | 40 |
| `4xl` | 56 |
| `5xl` | 80 |

## Typography (`typography.ts`)

### Font Families

| Token | Value |
|---|---|
| `sans` | `Inter, system-ui, -apple-system, sans-serif` |
| `mono` | `JetBrains Mono, Fira Code, monospace` |

### Font Sizes (px)

| Token | px | rem (Tailwind) |
|---|---|---|
| `xs` | 12 | 0.75rem |
| `sm` | 14 | 0.875rem |
| `base` | 16 | 1rem |
| `lg` | 18 | 1.125rem |
| `xl` | 20 | 1.25rem |
| `2xl` | 24 | 1.5rem |
| `3xl` | 30 | 1.875rem |
| `4xl` | 36 | 2.25rem |

### Font Weights

| Token | Value |
|---|---|
| `normal` | `400` |
| `medium` | `500` |
| `semibold` | `600` |
| `bold` | `700` |

### Line Heights

| Token | Value |
|---|---|
| `tight` | 1.25 |
| `normal` | 1.5 |
| `relaxed` | 1.75 |

## Tailwind Preset (`tailwind-preset.ts`)

Exported as `strawbossPreset`. Extends Tailwind's `theme.extend` with:

- `colors`: All tokens mapped (primary with 50-900 shade scale, neutral with 50-900 scale, semantic colors with DEFAULT).
- `spacing`: Numeric values converted to `"Npx"` strings.
- `fontFamily`: `sans` and `mono` arrays.
- `fontSize`: Converted to rem strings (`px / 16`).
- `fontWeight`: Passed through as strings.
- `lineHeight`: Converted to string values.

Usage in `apps/admin-web/tailwind.config.ts`:
```ts
import { strawbossPreset } from '@strawboss/ui-tokens/tailwind-preset';
// presets: [strawbossPreset]
```

## React Native Helpers (`native.ts`)

Exported as `@strawboss/ui-tokens/native`.

| Export | Description |
|---|---|
| `nativeColors` | Direct re-export of `colors` object |
| `nativeSpacing` | Direct re-export of `spacing` (numeric px) |
| `nativeFontSizes` | Direct re-export of `fontSizes` (numeric px) |
| `nativeFontWeights` | `{ normal: '400', medium: '500', semibold: '600', bold: '700' }` with `as const` |
| `nativeLineHeights` | Computed: `Math.round(fontSize * lineHeights.normal)` per size token |
| `shadows` | Three levels of React Native shadow styles |

### Shadow Styles

| Token | Properties |
|---|---|
| `sm` | offset: 0,1; opacity: 0.05; radius: 2; elevation: 1 |
| `md` | offset: 0,2; opacity: 0.1; radius: 4; elevation: 3 |
| `lg` | offset: 0,4; opacity: 0.15; radius: 8; elevation: 5 |

## Module Exports (`index.ts`)

The barrel export re-exports `colors`, `spacing`, and `typography` (fontFamilies, fontSizes, fontWeights, lineHeights). The Tailwind preset and native helpers are separate entry points (`/tailwind-preset` and `/native`).
