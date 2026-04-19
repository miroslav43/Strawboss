# Strawboss Mobile — Complete Modern UI Redesign

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Strawboss mobile app's visual layer for a premium, outdoor-ready look — without changing any business logic, navigation, or component props.

**Architecture:** Two-tone screen pattern (dark green header → beige body sliding up with borderRadius:24), upgraded component sizing and shadows, pill indicator tab bar, full-green login screen. All 16 file changes are styling-only.

**Tech Stack:** React Native StyleSheet, `@expo/vector-icons` MaterialCommunityIcons, `@strawboss/ui-tokens` colors, expo-router Tabs, react-native-safe-area-context

---

## Context

The current app is functional but visually flat — plain beige backgrounds with text titles and a basic white tab bar. The redesign makes the app feel premium and field-ready: large touch targets (min 60 px), high contrast for sunlight, a consistent dark-green header identity, and subtle but visible depth via shadows. No emojis, no new libraries, no prop or logic changes.

---

## Files Changed

| # | File | Change type |
|---|------|-------------|
| 1 | `apps/mobile/src/components/ui/TabBarIcon.tsx` | **Create** |
| 2 | `apps/mobile/src/components/ui/index.ts` | Modify — add export |
| 3 | `apps/mobile/src/components/ui/BigButton.tsx` | Modify — styles only |
| 4 | `apps/mobile/src/components/ui/ActionCard.tsx` | Modify — styles only |
| 5 | `apps/mobile/src/components/ui/StatusPill.tsx` | Modify — styles only |
| 6 | `apps/mobile/src/components/ui/NumericPad.tsx` | Modify — styles only |
| 7 | `apps/mobile/src/components/shared/OfflineBanner.tsx` | Modify — add icon |
| 8 | `apps/mobile/src/components/shared/TaskList.tsx` | Modify — styles + priority border |
| 9 | `apps/mobile/src/components/shared/TripProgress.tsx` | Modify — styles only |
| 10 | `apps/mobile/src/components/shared/AlertBanner.tsx` | Modify — left border accent |
| 11a | `apps/mobile/app/(baler)/_layout.tsx` | Modify — tab bar + TabBarIcon |
| 11b | `apps/mobile/app/(driver)/_layout.tsx` | Modify — tab bar + TabBarIcon |
| 11c | `apps/mobile/app/(loader)/_layout.tsx` | Modify — tab bar + TabBarIcon |
| 11d | `apps/mobile/app/(tabs)/_layout.tsx` | Modify — tab bar + TabBarIcon |
| 12 | `apps/mobile/app/(auth)/login.tsx` | Modify — full green bg + white card |
| 13 | `apps/mobile/app/(baler)/index.tsx` | Modify — two-tone header pattern |
| 14 | `apps/mobile/app/(driver)/index.tsx` | Modify — two-tone header pattern |
| 15 | `apps/mobile/app/(loader)/index.tsx` | Modify — two-tone header pattern |
| 16 | `apps/mobile/src/components/ProfileScreen.tsx` | Modify — two-tone header pattern |

---

## Key Design Decisions

- **Two-tone screens**: `backgroundColor:'#0A5C36'` on the outer `View`, `SafeAreaView edges={['top']}` so the green bleeds into the status bar, then a `ScrollView`/`FlatList` with `backgroundColor:'#F3DED8'` and `borderTopLeftRadius:24, borderTopRightRadius:24` for the "card slides up" premium look.
- **Tab bar pill indicator**: `TabBarIcon` wraps `MaterialCommunityIcons` in a 48×30 container with `backgroundColor: colors.primary50` when `focused`, transparent otherwise. Tab bar height raised to 72 with a top shadow.
- **Login**: Full `#0A5C36` background, brand text in white above a white card (borderRadius:24) that contains the form. `eye`/`eye-off` icons replace the current text toggles.
- **Sizing bumps**: BigButton 56→60 px height, borderRadius 12→16; ActionCard icon container 48→56 px; NumericPad keys 64→72 px; avatar 72→88 px.
- **No new libraries**, no NativeWind, no Reanimated (it's installed but intentionally unused here too).

---

## Task 1 — Create `TabBarIcon.tsx`

**Files:**
- Create: `apps/mobile/src/components/ui/TabBarIcon.tsx`

- [ ] **Step 1: Write the file**

```tsx
import { View, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '@strawboss/ui-tokens';

interface TabBarIconProps {
  name: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  focused: boolean;
  color: string;
  size: number;
}

export function TabBarIcon({ name, focused, color, size }: TabBarIconProps) {
  return (
    <View style={[styles.pill, focused && styles.pillFocused]}>
      <MaterialCommunityIcons name={name} size={size} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    width: 48,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  pillFocused: {
    backgroundColor: colors.primary50,
  },
});
```

- [ ] **Step 2: Run type-check**

```bash
pnpm --filter @strawboss/mobile typecheck
```

Expected: no errors for this file.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/components/ui/TabBarIcon.tsx
git commit -m "feat(mobile/ui): add TabBarIcon with focused pill indicator"
```

---

## Task 2 — Update `index.ts` barrel export

**Files:**
- Modify: `apps/mobile/src/components/ui/index.ts`

- [ ] **Step 1: Replace file content**

```ts
export { BigButton } from './BigButton';
export { NumericPad } from './NumericPad';
export { ActionCard } from './ActionCard';
export { StatusPill } from './StatusPill';
export { TabBarIcon } from './TabBarIcon';
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/src/components/ui/index.ts
git commit -m "chore(mobile/ui): export TabBarIcon from barrel"
```

---

## Task 3 — `BigButton.tsx` — larger, rounder

**Files:**
- Modify: `apps/mobile/src/components/ui/BigButton.tsx`

Changes: height 56→60, borderRadius 12→16, fontSize 18→17, add letterSpacing 0.3.

- [ ] **Step 1: Replace the StyleSheet block**

Full replacement file:

```tsx
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { colors } from '@strawboss/ui-tokens';

interface BigButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'outline';
  disabled?: boolean;
  loading?: boolean;
}

const variantStyles: Record<
  NonNullable<BigButtonProps['variant']>,
  { container: ViewStyle; text: TextStyle }
> = {
  primary: {
    container: { backgroundColor: colors.primary },
    text: { color: colors.white },
  },
  secondary: {
    container: { backgroundColor: colors.secondary },
    text: { color: colors.white },
  },
  danger: {
    container: { backgroundColor: colors.danger },
    text: { color: colors.white },
  },
  outline: {
    container: {
      backgroundColor: 'transparent',
      borderWidth: 2,
      borderColor: colors.primary,
    },
    text: { color: colors.primary },
  },
};

export function BigButton({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
}: BigButtonProps) {
  const vs = variantStyles[variant];

  return (
    <TouchableOpacity
      style={[styles.container, vs.container, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'outline' ? colors.primary : colors.white}
          size="small"
        />
      ) : (
        <Text style={[styles.text, vs.text]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 60,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  text: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  disabled: {
    opacity: 0.5,
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/src/components/ui/BigButton.tsx
git commit -m "feat(mobile/ui): increase BigButton size and border radius"
```

---

## Task 4 — `ActionCard.tsx` — stronger shadow, bigger icon

**Files:**
- Modify: `apps/mobile/src/components/ui/ActionCard.tsx`

Changes: borderRadius 16→20, padding 16→18, iconContainer 48×48→56×56 with borderRadius 16, elevation 3→4, shadowOpacity 0.1→0.12, shadowRadius 4→8, active borderWidth 2→2.5.

- [ ] **Step 1: Replace file**

```tsx
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '@strawboss/ui-tokens';

interface ActionCardProps {
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  onPress: () => void;
  variant?: 'default' | 'active' | 'completed';
}

export function ActionCard({
  title,
  subtitle,
  icon,
  onPress,
  variant = 'default',
}: ActionCardProps) {
  return (
    <TouchableOpacity
      style={[
        styles.container,
        variant === 'active' && styles.active,
        variant === 'completed' && styles.completed,
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.iconContainer}>{icon}</View>
      <View style={styles.content}>
        <Text
          style={[
            styles.title,
            variant === 'active' && styles.activeTitle,
            variant === 'completed' && styles.completedTitle,
          ]}
        >
          {title}
        </Text>
        {subtitle && (
          <Text
            style={[
              styles.subtitle,
              variant === 'completed' && styles.completedSubtitle,
            ]}
          >
            {subtitle}
          </Text>
        )}
      </View>
      {variant === 'completed' && (
        <MaterialCommunityIcons
          name="check-circle"
          size={24}
          color={colors.success}
          accessibilityLabel="Finalizat"
        />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 80,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 20,
    padding: 18,
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  active: {
    borderWidth: 2.5,
    borderColor: colors.primary,
    backgroundColor: colors.primary50,
  },
  completed: {
    backgroundColor: '#E8F5E9',
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.black,
  },
  activeTitle: {
    color: colors.primary,
  },
  completedTitle: {
    color: colors.success,
  },
  subtitle: {
    fontSize: 13,
    color: colors.neutral,
  },
  completedSubtitle: {
    color: colors.success,
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/src/components/ui/ActionCard.tsx
git commit -m "feat(mobile/ui): larger icon container and stronger shadow on ActionCard"
```

---

## Task 5 — `StatusPill.tsx` — uppercase + more padding

**Files:**
- Modify: `apps/mobile/src/components/ui/StatusPill.tsx`

Changes: `textTransform:'uppercase'`, `letterSpacing:0.5`, md paddingHorizontal 12→14, paddingVertical 6→7, fontSize md 13→12, sm 11→10.

- [ ] **Step 1: Replace file**

```tsx
import { View, Text, StyleSheet } from 'react-native';

interface StatusPillProps {
  status: string;
  size?: 'sm' | 'md';
}

interface PillStyle {
  bg: string;
  text: string;
}

const STATUS_STYLES: Record<string, PillStyle> = {
  planned:    { bg: '#9E9E9E', text: '#FFFFFF' },
  loading:    { bg: '#F59E0B', text: '#FFFFFF' },
  loaded:     { bg: '#D97706', text: '#FFFFFF' },
  in_transit: { bg: '#1565C0', text: '#FFFFFF' },
  arrived:    { bg: '#2196F3', text: '#FFFFFF' },
  delivering: { bg: '#2E7D32', text: '#FFFFFF' },
  delivered:  { bg: '#1B5E20', text: '#FFFFFF' },
  completed:  { bg: '#0A5C36', text: '#FFFFFF' },
  cancelled:  { bg: '#C62828', text: '#FFFFFF' },
  disputed:   { bg: '#C62828', text: '#FFFFFF' },
};

const DEFAULT_STYLE: PillStyle = { bg: '#9E9E9E', text: '#FFFFFF' };

function formatStatus(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function StatusPill({ status, size = 'md' }: StatusPillProps) {
  const pillStyle = STATUS_STYLES[status] ?? DEFAULT_STYLE;
  const isMd = size === 'md';

  return (
    <View
      style={[
        styles.pill,
        { backgroundColor: pillStyle.bg },
        isMd ? styles.md : styles.sm,
      ]}
    >
      <Text
        style={[
          styles.text,
          { color: pillStyle.text },
          isMd ? styles.textMd : styles.textSm,
        ]}
      >
        {formatStatus(status)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  md: {
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  sm: {
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  text: {
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  textMd: {
    fontSize: 12,
  },
  textSm: {
    fontSize: 10,
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/src/components/ui/StatusPill.tsx
git commit -m "feat(mobile/ui): uppercase + letter-spacing on StatusPill"
```

---

## Task 6 — `NumericPad.tsx` — larger keys

**Files:**
- Modify: `apps/mobile/src/components/ui/NumericPad.tsx`

Changes: key 64×64→72×72, borderRadius 12→14, displayText 40→48, gap 10→12, elevation 2→3.

- [ ] **Step 1: Replace file**

```tsx
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors } from '@strawboss/ui-tokens';

interface NumericPadProps {
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  decimal?: boolean;
}

export function NumericPad({
  value,
  onChange,
  maxLength = 6,
  decimal = false,
}: NumericPadProps) {
  const handlePress = (key: string) => {
    if (key === 'backspace') {
      onChange(value.slice(0, -1));
      return;
    }
    if (key === 'clear') {
      onChange('');
      return;
    }
    if (key === '.' && (!decimal || value.includes('.'))) {
      return;
    }
    if (value.length >= maxLength) return;
    onChange(value + key);
  };

  const bottomLeft = decimal ? '.' : 'clear';
  const rows = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    [bottomLeft, '0', 'backspace'],
  ];

  return (
    <View style={styles.container}>
      <View style={styles.display}>
        <Text style={styles.displayText}>{value || '0'}</Text>
      </View>
      <View style={styles.pad}>
        {rows.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.row}>
            {row.map((key) => (
              <TouchableOpacity
                key={key}
                style={[
                  styles.key,
                  (key === 'backspace' || key === 'clear') && styles.actionKey,
                ]}
                onPress={() => handlePress(key)}
                activeOpacity={0.6}
              >
                <Text
                  style={[
                    styles.keyText,
                    (key === 'backspace' || key === 'clear') && styles.actionKeyText,
                  ]}
                >
                  {key === 'backspace' ? '\u232B' : key === 'clear' ? 'C' : key}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 16,
  },
  display: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  displayText: {
    fontSize: 48,
    fontWeight: '700',
    color: colors.primary,
  },
  pad: {
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  key: {
    width: 72,
    height: 72,
    borderRadius: 14,
    backgroundColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 2,
    elevation: 3,
  },
  actionKey: {
    backgroundColor: colors.surface,
  },
  keyText: {
    fontSize: 28,
    fontWeight: '600',
    color: colors.black,
  },
  actionKeyText: {
    color: colors.neutral,
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/src/components/ui/NumericPad.tsx
git commit -m "feat(mobile/ui): larger NumericPad keys (72px)"
```

---

## Task 7 — `OfflineBanner.tsx` — add wifi-off icon

**Files:**
- Modify: `apps/mobile/src/components/shared/OfflineBanner.tsx`

- [ ] **Step 1: Replace file**

```tsx
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { colors } from '@strawboss/ui-tokens';

export function OfflineBanner() {
  const { isConnected } = useNetworkStatus();

  if (isConnected) return null;

  return (
    <View style={styles.banner}>
      <MaterialCommunityIcons
        name="wifi-off"
        size={18}
        color={colors.white}
        accessibilityLabel="Fără conexiune"
      />
      <Text style={styles.text}>
        Offline — changes will sync when connected
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.warning,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  text: {
    color: colors.white,
    fontWeight: '600',
    fontSize: 14,
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/src/components/shared/OfflineBanner.tsx
git commit -m "feat(mobile): add wifi-off icon to OfflineBanner"
```

---

## Task 8 — `TaskList.tsx` — priority border + sequence circle

**Files:**
- Modify: `apps/mobile/src/components/shared/TaskList.tsx`

Changes: sectionTitle fontSize 16→17, fontWeight '600'→'700', color neutral→primary; card borderRadius 12→16, padding 14→16; urgent/high items get `borderLeftWidth:3, borderLeftColor`; sequence number wrapped in a 24×24 green-tinted circle.

- [ ] **Step 1: Replace file**

```tsx
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '@strawboss/ui-tokens';
import type { MyTask } from '@/hooks/useMyTasks';

const STATUS_COLORS: Record<string, string> = {
  available:   '#1565C0',
  in_progress: '#B7791F',
  done:        '#2E7D32',
};

const STATUS_LABELS: Record<string, string> = {
  available:   'Disponibil',
  in_progress: 'În lucru',
  done:        'Finalizat',
};

const PRIORITY_COLORS: Record<string, string | undefined> = {
  urgent: '#DC2626',
  high:   '#EA580C',
  normal: undefined,
  low:    undefined,
};

interface SubtitleInfo {
  icon: 'map-marker' | 'tractor';
  text: string;
}

interface TaskListProps {
  tasks: MyTask[];
  role: 'baler_operator' | 'loader_operator' | 'driver' | string;
}

export function TaskList({ tasks, role }: TaskListProps) {
  if (tasks.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>Nicio sarcină asignată pentru azi.</Text>
      </View>
    );
  }

  const handlePress = (task: MyTask) => {
    const rolePrefix =
      role === 'baler_operator'
        ? '(baler)'
        : role === 'driver'
          ? '(driver)'
          : role === 'loader_operator'
            ? '(loader)'
            : '(tabs)';
    router.push(`/${rolePrefix}/map?focusId=${task.parcelId ?? task.destinationId ?? ''}`);
  };

  const getTaskLabel = (task: MyTask): string => {
    if (task.parcelName) return task.parcelName;
    if (task.destinationName) return task.destinationName;
    if (task.parcelCode) return task.parcelCode;
    if (task.destinationCode) return task.destinationCode;
    return `Sarcina #${task.sequenceOrder}`;
  };

  const getSubtitle = (task: MyTask): SubtitleInfo | null => {
    if (role === 'driver' && task.destinationName) {
      return { icon: 'map-marker', text: task.destinationName };
    }
    if (task.machineCode) {
      return { icon: 'tractor', text: task.machineCode };
    }
    return null;
  };

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>Sarcini Azi</Text>
      <FlatList
        data={tasks}
        keyExtractor={(item) => item.id}
        scrollEnabled={false}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const priorityColor = PRIORITY_COLORS[item.priority];
          const subtitle = getSubtitle(item);
          return (
            <TouchableOpacity
              style={[
                styles.card,
                priorityColor !== undefined && {
                  borderLeftWidth: 3,
                  borderLeftColor: priorityColor,
                },
              ]}
              onPress={() => handlePress(item)}
            >
              <View style={styles.cardHeader}>
                <View style={styles.titleRow}>
                  <View style={styles.sequenceCircle}>
                    <Text style={styles.sequence}>{item.sequenceOrder}</Text>
                  </View>
                  {priorityColor !== undefined && (
                    <MaterialCommunityIcons
                      name="circle"
                      size={10}
                      color={priorityColor}
                      accessibilityLabel={item.priority === 'urgent' ? 'Urgent' : 'Prioritate mare'}
                    />
                  )}
                  <Text style={styles.taskName} numberOfLines={1}>
                    {getTaskLabel(item)}
                  </Text>
                </View>
                <View
                  style={[
                    styles.badge,
                    { backgroundColor: STATUS_COLORS[item.status] ?? '#5D4037' },
                  ]}
                >
                  <Text style={styles.badgeText}>
                    {STATUS_LABELS[item.status] ?? item.status}
                  </Text>
                </View>
              </View>
              {subtitle !== null && (
                <View style={styles.subtitleRow}>
                  <MaterialCommunityIcons
                    name={subtitle.icon}
                    size={13}
                    color={colors.neutral400}
                  />
                  <Text style={styles.subtitle}>{subtitle.text}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: colors.primary },
  list: { gap: 8 },
  emptyContainer: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
  },
  emptyText: { fontSize: 13, color: colors.neutral400 },
  card: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 16,
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 6 },
  sequenceCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primary50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sequence: { fontSize: 12, fontWeight: '700', color: colors.primary },
  taskName: { fontSize: 15, fontWeight: '500', color: colors.black, flex: 1 },
  badge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, marginLeft: 8 },
  badgeText: { color: colors.white, fontSize: 11, fontWeight: '600' },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 30 },
  subtitle: { fontSize: 13, color: colors.neutral },
});
```

Note: `subtitleRow` marginLeft is 30 (was 22) to align under the wider sequenceCircle + gap.

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/src/components/shared/TaskList.tsx
git commit -m "feat(mobile): sequence circle + priority border on TaskList cards"
```

---

## Task 9 — `TripProgress.tsx` — larger dots

**Files:**
- Modify: `apps/mobile/src/components/shared/TripProgress.tsx`

Changes: dot 12×12→14×14 (radius 6→7), dotCurrent 14×14→18×18 (radius 7→9), label fontSize 9→10, add paddingHorizontal:4 to container.

- [ ] **Step 1: Replace file**

```tsx
import { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet, Easing } from 'react-native';
import { colors } from '@strawboss/ui-tokens';

const STEPS = [
  'planned',
  'loading',
  'loaded',
  'in_transit',
  'arrived',
  'delivering',
  'delivered',
  'completed',
] as const;

const STEP_LABELS: Record<string, string> = {
  planned:    'Plan',
  loading:    'Load',
  loaded:     'Loaded',
  in_transit: 'Transit',
  arrived:    'Arrive',
  delivering: 'Deliver',
  delivered:  'Done',
  completed:  'Complete',
};

interface TripProgressProps {
  currentStatus: string;
}

export function TripProgress({ currentStatus }: TripProgressProps) {
  const currentIndex = STEPS.indexOf(currentStatus as (typeof STEPS)[number]);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.3,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulseAnim]);

  return (
    <View style={styles.container}>
      <View style={styles.stepsRow}>
        {STEPS.map((step, index) => {
          const isCompleted = index < currentIndex;
          const isCurrent   = index === currentIndex;
          const isFuture    = index > currentIndex;

          return (
            <View key={step} style={styles.stepItem}>
              <View style={styles.dotRow}>
                {index > 0 && (
                  <View
                    style={[
                      styles.line,
                      isCompleted || isCurrent ? styles.lineCompleted : styles.lineFuture,
                    ]}
                  />
                )}
                {isCurrent ? (
                  <Animated.View
                    style={[
                      styles.dot,
                      styles.dotCurrent,
                      { transform: [{ scale: pulseAnim }] },
                    ]}
                  />
                ) : (
                  <View
                    style={[
                      styles.dot,
                      isCompleted && styles.dotCompleted,
                      isFuture    && styles.dotFuture,
                    ]}
                  />
                )}
                {index < STEPS.length - 1 && (
                  <View
                    style={[
                      styles.line,
                      isCompleted ? styles.lineCompleted : styles.lineFuture,
                    ]}
                  />
                )}
              </View>
              <Text
                style={[
                  styles.label,
                  isCurrent && styles.labelCurrent,
                  isFuture  && styles.labelFuture,
                ]}
              >
                {STEP_LABELS[step] ?? step}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  stepsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  stepItem: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  dotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    justifyContent: 'center',
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.primary,
  },
  dotCompleted: {
    backgroundColor: colors.primary,
  },
  dotCurrent: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.secondary,
  },
  dotFuture: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: colors.neutral200,
  },
  line: {
    flex: 1,
    height: 2,
  },
  lineCompleted: {
    backgroundColor: colors.primary,
  },
  lineFuture: {
    backgroundColor: colors.neutral200,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.neutral,
    textAlign: 'center',
  },
  labelCurrent: {
    color: colors.primary,
    fontWeight: '700',
  },
  labelFuture: {
    color: colors.neutral200,
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/src/components/shared/TripProgress.tsx
git commit -m "feat(mobile): larger step dots and labels in TripProgress"
```

---

## Task 10 — `AlertBanner.tsx` — left border accent

**Files:**
- Modify: `apps/mobile/src/components/shared/AlertBanner.tsx`

Changes: borderRadius 12→14, paddingVertical 12→14, add `borderLeftWidth:3` with `borderLeftColor: config.text`.

- [ ] **Step 1: Replace file**

```tsx
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

type AlertSeverity = 'warning' | 'error';

interface AlertBannerProps {
  message: string;
  severity: AlertSeverity;
  onDismiss?: () => void;
}

const SEVERITY_CONFIG: Record<
  AlertSeverity,
  { background: string; text: string; iconName: 'alert' | 'close-circle' }
> = {
  warning: {
    background: '#FEF3C7',
    text: '#92400E',
    iconName: 'alert',
  },
  error: {
    background: '#FEE2E2',
    text: '#991B1B',
    iconName: 'close-circle',
  },
} as const;

export function AlertBanner({ message, severity, onDismiss }: AlertBannerProps) {
  const config = SEVERITY_CONFIG[severity];

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: config.background,
          borderLeftColor: config.text,
        },
      ]}
    >
      <MaterialCommunityIcons
        name={config.iconName}
        size={18}
        color={config.text}
        accessibilityLabel={severity === 'warning' ? 'Avertisment' : 'Eroare'}
      />
      <Text style={[styles.message, { color: config.text }]}>{message}</Text>
      {onDismiss !== undefined && (
        <TouchableOpacity
          style={styles.dismissButton}
          onPress={onDismiss}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Închide alerta"
          accessibilityRole="button"
        >
          <MaterialCommunityIcons name="close" size={20} color={config.text} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderLeftWidth: 3,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
  },
  message: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  dismissButton: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 28,
    height: 28,
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/src/components/shared/AlertBanner.tsx
git commit -m "feat(mobile): left border accent stripe on AlertBanner"
```

---

## Task 11 — Tab layouts — elevated tab bar + TabBarIcon

All four layouts get the same `screenOptions` upgrade and every `tabBarIcon` prop uses `TabBarIcon`.

**Files:**
- Modify: `apps/mobile/app/(baler)/_layout.tsx`
- Modify: `apps/mobile/app/(driver)/_layout.tsx`
- Modify: `apps/mobile/app/(loader)/_layout.tsx`
- Modify: `apps/mobile/app/(tabs)/_layout.tsx`

### `(baler)/_layout.tsx`

- [ ] **Step 1: Replace file**

```tsx
import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { useGeofenceNotifications } from '@/hooks/useGeofenceNotifications';
import { GeofenceOverlay } from '@/components/shared/GeofenceOverlay';
import { TabBarIcon } from '@/components/ui/TabBarIcon';

export default function BalerTabLayout() {
  const { activeAlert, dismissAlert, confirmParcelDone } = useGeofenceNotifications();

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: '#0A5C36',
          tabBarInactiveTintColor: '#8D6E63',
          tabBarStyle: {
            backgroundColor: '#FFFFFF',
            borderTopColor: '#D7CCC8',
            height: 72,
            paddingBottom: 12,
            paddingTop: 4,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: -2 },
            shadowOpacity: 0.06,
            shadowRadius: 8,
            elevation: 8,
          },
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: '600',
            marginTop: 2,
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Acasă',
            tabBarAccessibilityLabel: 'Acasă',
            tabBarIcon: ({ color, size, focused }) => (
              <TabBarIcon name="home" focused={focused} color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="consumables"
          options={{
            title: 'Consumabile',
            tabBarAccessibilityLabel: 'Consumabile',
            tabBarIcon: ({ color, size, focused }) => (
              <TabBarIcon name="package-variant-closed" focused={focused} color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="map"
          options={{
            title: 'Hartă',
            tabBarAccessibilityLabel: 'Hartă',
            tabBarIcon: ({ color, size, focused }) => (
              <TabBarIcon name="map" focused={focused} color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="stats"
          options={{
            title: 'Starea Mea',
            tabBarAccessibilityLabel: 'Statistici',
            tabBarIcon: ({ color, size, focused }) => (
              <TabBarIcon name="chart-bar" focused={focused} color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profil',
            tabBarAccessibilityLabel: 'Profilul meu',
            tabBarIcon: ({ color, size, focused }) => (
              <TabBarIcon name="account" focused={focused} color={color} size={size} />
            ),
          }}
        />
      </Tabs>
      <GeofenceOverlay
        alert={activeAlert}
        onDismiss={dismissAlert}
        onConfirmParcelDone={confirmParcelDone}
      />
    </View>
  );
}
```

### `(driver)/_layout.tsx`

- [ ] **Step 2: Replace file**

```tsx
import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { useGeofenceNotifications } from '@/hooks/useGeofenceNotifications';
import { GeofenceOverlay } from '@/components/shared/GeofenceOverlay';
import { TabBarIcon } from '@/components/ui/TabBarIcon';

export default function DriverTabLayout() {
  const { activeAlert, dismissAlert, confirmParcelDone } = useGeofenceNotifications();

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: '#0A5C36',
          tabBarInactiveTintColor: '#8D6E63',
          tabBarStyle: {
            backgroundColor: '#FFFFFF',
            borderTopColor: '#D7CCC8',
            height: 72,
            paddingBottom: 12,
            paddingTop: 4,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: -2 },
            shadowOpacity: 0.06,
            shadowRadius: 8,
            elevation: 8,
          },
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: '600',
            marginTop: 2,
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Cursele Mele',
            tabBarAccessibilityLabel: 'Cursele mele',
            tabBarIcon: ({ color, size, focused }) => (
              <TabBarIcon name="truck" focused={focused} color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="delivery"
          options={{
            title: 'Livrare',
            tabBarAccessibilityLabel: 'Livrare',
            tabBarIcon: ({ color, size, focused }) => (
              <TabBarIcon name="clipboard-list" focused={focused} color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="map"
          options={{
            title: 'Hartă',
            tabBarAccessibilityLabel: 'Hartă',
            tabBarIcon: ({ color, size, focused }) => (
              <TabBarIcon name="map" focused={focused} color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="fuel"
          options={{
            title: 'Combustibil',
            tabBarAccessibilityLabel: 'Combustibil',
            tabBarIcon: ({ color, size, focused }) => (
              <TabBarIcon name="gas-station" focused={focused} color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profil',
            tabBarAccessibilityLabel: 'Profilul meu',
            tabBarIcon: ({ color, size, focused }) => (
              <TabBarIcon name="account" focused={focused} color={color} size={size} />
            ),
          }}
        />
      </Tabs>
      <GeofenceOverlay
        alert={activeAlert}
        onDismiss={dismissAlert}
        onConfirmParcelDone={confirmParcelDone}
      />
    </View>
  );
}
```

### `(loader)/_layout.tsx`

- [ ] **Step 3: Replace file**

```tsx
import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { useGeofenceNotifications } from '@/hooks/useGeofenceNotifications';
import { GeofenceOverlay } from '@/components/shared/GeofenceOverlay';
import { TabBarIcon } from '@/components/ui/TabBarIcon';

export default function LoaderTabLayout() {
  const { activeAlert, dismissAlert, confirmParcelDone } = useGeofenceNotifications();

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: '#0A5C36',
          tabBarInactiveTintColor: '#8D6E63',
          tabBarStyle: {
            backgroundColor: '#FFFFFF',
            borderTopColor: '#D7CCC8',
            height: 72,
            paddingBottom: 12,
            paddingTop: 4,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: -2 },
            shadowOpacity: 0.06,
            shadowRadius: 8,
            elevation: 8,
          },
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: '600',
            marginTop: 2,
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Scanează',
            tabBarAccessibilityLabel: 'Scanează codul QR',
            tabBarIcon: ({ color, size, focused }) => (
              <TabBarIcon name="qrcode-scan" focused={focused} color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="bales"
          options={{
            title: 'Încărcări',
            tabBarAccessibilityLabel: 'Încărcări',
            tabBarIcon: ({ color, size, focused }) => (
              <TabBarIcon name="package-variant-closed" focused={focused} color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="map"
          options={{
            title: 'Hartă',
            tabBarAccessibilityLabel: 'Hartă',
            tabBarIcon: ({ color, size, focused }) => (
              <TabBarIcon name="map" focused={focused} color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="consumables"
          options={{
            title: 'Consumabile',
            tabBarAccessibilityLabel: 'Consumabile',
            tabBarIcon: ({ color, size, focused }) => (
              <TabBarIcon name="package-variant-closed" focused={focused} color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profil',
            tabBarAccessibilityLabel: 'Profilul meu',
            tabBarIcon: ({ color, size, focused }) => (
              <TabBarIcon name="account" focused={focused} color={color} size={size} />
            ),
          }}
        />
      </Tabs>
      <GeofenceOverlay
        alert={activeAlert}
        onDismiss={dismissAlert}
        onConfirmParcelDone={confirmParcelDone}
      />
    </View>
  );
}
```

### `(tabs)/_layout.tsx`

- [ ] **Step 4: Replace file**

```tsx
import { Tabs } from 'expo-router';
import { TabBarIcon } from '@/components/ui/TabBarIcon';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#0A5C36',
        tabBarInactiveTintColor: '#8D6E63',
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopColor: '#D7CCC8',
          height: 72,
          paddingBottom: 12,
          paddingTop: 4,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.06,
          shadowRadius: 8,
          elevation: 8,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarAccessibilityLabel: 'Acasă',
          tabBarIcon: ({ color, size, focused }) => (
            <TabBarIcon name="home" focused={focused} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Scan',
          tabBarAccessibilityLabel: 'Scanează',
          tabBarIcon: ({ color, size, focused }) => (
            <TabBarIcon name="qrcode-scan" focused={focused} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="trips"
        options={{
          title: 'Trips',
          tabBarAccessibilityLabel: 'Curse',
          tabBarIcon: ({ color, size, focused }) => (
            <TabBarIcon name="map-marker-path" focused={focused} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="sync"
        options={{
          title: 'Sync',
          tabBarAccessibilityLabel: 'Sincronizare',
          tabBarIcon: ({ color, size, focused }) => (
            <TabBarIcon name="sync" focused={focused} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profil',
          tabBarAccessibilityLabel: 'Profilul meu',
          tabBarIcon: ({ color, size, focused }) => (
            <TabBarIcon name="account" focused={focused} color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
```

- [ ] **Step 5: Run type-check and commit all 4 layouts**

```bash
pnpm --filter @strawboss/mobile typecheck
git add apps/mobile/app/(baler)/_layout.tsx apps/mobile/app/(driver)/_layout.tsx apps/mobile/app/(loader)/_layout.tsx apps/mobile/app/(tabs)/_layout.tsx
git commit -m "feat(mobile): elevated tab bar with pill indicator (TabBarIcon)"
```

---

## Task 12 — Login screen — full green background + white form card

**Files:**
- Modify: `apps/mobile/app/(auth)/login.tsx`

All business logic preserved verbatim. JSX and styles replaced entirely. Key visual changes:
- `backgroundColor: '#0A5C36'` fills the entire screen
- `SafeAreaView edges={['top','bottom']}` still handles insets
- Brand title + subtitle in white above a white card
- `MaterialCommunityIcons 'eye'/'eye-off'` replaces the text `'O'`/`'*'` toggle
- Login button reuses the new BigButton dimensions: height 60, borderRadius 16

- [ ] **Step 1: Replace file**

```tsx
import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getSupabaseClient } from '@/lib/auth';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';

/**
 * Mirror backend's pinToAuthPassword: Supabase Auth requires ≥6 chars but
 * user PINs are 4 digits. We pad before calling signInWithPassword.
 * Must stay in sync with backend/service/src/admin-users/admin-users.service.ts.
 */
function pinToAuthPassword(pin: string): string {
  return `sb_${pin}`;
}

/** Resolve a username to an email via the backend. Returns null on failure. */
async function resolveLogin(login: string): Promise<string | null> {
  if (login.includes('@')) return login;
  try {
    const res = await fetch(`${API_URL}/api/v1/auth/resolve`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ login }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { email?: string };
    return data.email ?? null;
  } catch {
    return null;
  }
}

export default function LoginScreen() {
  const [login,        setLogin]        = useState('');
  const [password,     setPassword]     = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  const handleLogin = async () => {
    if (!login.trim() || !password.trim()) {
      setError('Username/email si parola sunt obligatorii');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const trimmedLogin = login.trim();
      const isUsername = !trimmedLogin.includes('@');
      const email = await resolveLogin(trimmedLogin);
      if (!email) {
        setError('Username inexistent. Verifica datele introduse.');
        setLoading(false);
        return;
      }

      // Operators/drivers log in with username + 4-digit PIN → pad to satisfy
      // Supabase Auth's min-6-char policy. Admins with email + long password
      // should pass through unchanged.
      const authPassword = isUsername ? pinToAuthPassword(password) : password;

      const supabase = getSupabaseClient();
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password: authPassword,
      });

      if (authError) {
        setError(authError.message);
      }
    } catch {
      setError('A aparut o eroare neasteptata');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.content}
      >
        <View style={styles.brandHeader}>
          <Text style={styles.brandTitle}>StrawBoss</Text>
          <Text style={styles.brandSubtitle}>Agricultural Logistics</Text>
        </View>

        <View style={styles.card}>
          <TextInput
            style={styles.input}
            placeholder="Username sau Email"
            placeholderTextColor="#9CA3AF"
            value={login}
            onChangeText={setLogin}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="username"
            editable={!loading}
          />

          <View style={styles.passwordContainer}>
            <TextInput
              style={styles.passwordInput}
              placeholder="PIN sau parola"
              placeholderTextColor="#9CA3AF"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoComplete="current-password"
              editable={!loading}
            />
            <TouchableOpacity
              style={styles.eyeButton}
              onPress={() => setShowPassword((v) => !v)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel={showPassword ? 'Ascunde parola' : 'Arată parola'}
            >
              <MaterialCommunityIcons
                name={showPassword ? 'eye' : 'eye-off'}
                size={22}
                color="#9CA3AF"
              />
            </TouchableOpacity>
          </View>

          {error && <Text style={styles.errorText}>{error}</Text>}

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={() => { void handleLogin(); }}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Autentificare</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A5C36',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  brandHeader: {
    alignItems: 'center',
    marginBottom: 32,
  },
  brandTitle: {
    fontSize: 40,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  brandSubtitle: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.75)',
    marginTop: 6,
    fontWeight: '500',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 8,
  },
  input: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#111827',
    borderWidth: 1,
    borderColor: '#D7CCC8',
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D7CCC8',
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#111827',
  },
  eyeButton: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: '#C62828',
    fontSize: 14,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#0A5C36',
    borderRadius: 16,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/app/(auth)/login.tsx
git commit -m "feat(mobile): full-green login screen with white form card"
```

---

## Task 13 — Baler home — two-tone header

**Files:**
- Modify: `apps/mobile/app/(baler)/index.tsx`

Pattern: outer `View` backgroundColor green → `SafeAreaView edges={['top']}` → green header with white text → beige `ScrollView` with borderTopRadius 24.

- [ ] **Step 1: Replace file**

```tsx
import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { BigButton } from '@/components/ui/BigButton';
import { OfflineBanner } from '@/components/shared/OfflineBanner';
import { TaskList } from '@/components/shared/TaskList';
import { useProfile } from '@/hooks/useProfile';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useMyTasks } from '@/hooks/useMyTasks';

export default function BalerHomeScreen() {
  const { profile, isLoading } = useProfile();
  const { isConnected } = useNetworkStatus();
  const { tasks, refetch: refetchTasks } = useMyTasks();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetchTasks();
    setRefreshing(false);
  };

  return (
    <View style={styles.outerContainer}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <OfflineBanner />
        <View style={styles.headerSection}>
          <Text style={styles.title}>Balotieră</Text>
          {isLoading ? (
            <ActivityIndicator color="#FFFFFF" style={styles.loader} />
          ) : (
            <Text style={styles.subtitle}>
              {profile?.fullName ?? 'Operator'}
            </Text>
          )}
        </View>
      </SafeAreaView>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <TaskList tasks={tasks} role="baler_operator" />

        <View style={styles.buttonGroup}>
          <BigButton
            title="Înregistrează producție"
            onPress={() => router.push('/baler-ops/production')}
          />
          <BigButton
            title="Notează consumabile"
            onPress={() => router.push('/(baler)/consumables')}
            variant="secondary"
          />
          <BigButton
            title="Starea mea"
            onPress={() => router.push('/(baler)/stats')}
            variant="outline"
          />
        </View>

        <View style={styles.statusCard}>
          <Text style={styles.cardTitle}>Conexiune</Text>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: isConnected ? '#2E7D32' : '#C62828' },
              ]}
            />
            <Text style={styles.statusText}>
              {isConnected ? 'Online' : 'Offline — datele vor fi sincronizate ulterior'}
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    backgroundColor: '#0A5C36',
  },
  safeArea: {
    backgroundColor: '#0A5C36',
  },
  headerSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 4,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  subtitle: {
    fontSize: 15,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  loader: {
    alignSelf: 'flex-start',
  },
  body: {
    flex: 1,
    backgroundColor: '#F3DED8',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  content: {
    padding: 16,
    gap: 16,
  },
  buttonGroup: { gap: 12, marginTop: 8 },
  statusCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardTitle: { fontSize: 14, fontWeight: '600', color: '#5D4037' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { fontSize: 13, color: '#374151', flex: 1 },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/app/(baler)/index.tsx
git commit -m "feat(mobile): two-tone header on baler home screen"
```

---

## Task 14 — Driver home — two-tone header

**Files:**
- Modify: `apps/mobile/app/(driver)/index.tsx`

The `TaskList` moves inside the green header zone. The `FlatList` of trips is the beige body.

- [ ] **Step 1: Replace file**

```tsx
import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { OfflineBanner } from '@/components/shared/OfflineBanner';
import { TaskList } from '@/components/shared/TaskList';
import { useAuthStore } from '@/stores/auth-store';
import { useMyTasks } from '@/hooks/useMyTasks';
import { getDatabase } from '@/lib/storage';
import { TripsRepo, type LocalTrip } from '@/db/trips-repo';

const STATUS_COLORS: Record<string, string> = {
  planned:    '#1565C0',
  loading:    '#B7791F',
  loaded:     '#0A5C36',
  in_transit: '#8D6E63',
  arrived:    '#2E7D32',
  delivering: '#B7791F',
  delivered:  '#2E7D32',
  completed:  '#5D4037',
};

const STATUS_LABELS: Record<string, string> = {
  planned:    'Planificat',
  loading:    'Se încarcă',
  loaded:     'Încărcat',
  in_transit: 'În drum',
  arrived:    'Sosit',
  delivering: 'Se livrează',
  delivered:  'Livrat',
  completed:  'Finalizat',
};

export default function DriverTripsScreen() {
  const userId = useAuthStore((s) => s.userId);
  const { tasks, refetch: refetchTasks } = useMyTasks();
  const [trips, setTrips] = useState<LocalTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadTrips = useCallback(async () => {
    try {
      const db = await getDatabase();
      const repo = new TripsRepo(db);
      const all = await repo.listActive();
      const mine = userId ? all.filter((t) => t.driver_id === userId) : all;
      setTrips(mine);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void loadTrips();
  }, [loadTrips]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadTrips(), refetchTasks()]);
    setRefreshing(false);
  };

  const handleTripPress = (trip: LocalTrip) => {
    if (trip.status === 'arrived' || trip.status === 'delivering') {
      router.push(`/driver-ops/delivery-flow?tripId=${trip.id}`);
    } else {
      router.push(`/trip/${trip.id}`);
    }
  };

  return (
    <View style={styles.outerContainer}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <OfflineBanner />
        <View style={styles.headerSection}>
          <Text style={styles.title}>Cursele Mele</Text>
          <TaskList tasks={tasks} role="driver" />
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={[styles.body, styles.centered]}>
          <ActivityIndicator color="#0A5C36" />
        </View>
      ) : (
        <FlatList
          style={styles.body}
          data={trips}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => handleTripPress(item)}>
              <View style={styles.cardHeader}>
                <Text style={styles.tripNumber}>{item.trip_number ?? 'Cursă'}</Text>
                <View style={[styles.badge, { backgroundColor: STATUS_COLORS[item.status] ?? '#5D4037' }]}>
                  <Text style={styles.badgeText}>
                    {STATUS_LABELS[item.status] ?? item.status}
                  </Text>
                </View>
              </View>
              {item.destination_name ? (
                <View style={styles.inlineRow}>
                  <MaterialCommunityIcons name="map-marker" size={14} color="#5D4037" />
                  <Text style={styles.destination}>{item.destination_name}</Text>
                </View>
              ) : null}
              <View style={styles.meta}>
                <View style={styles.inlineRow}>
                  <MaterialCommunityIcons name="grain" size={13} color="#8D6E63" />
                  <Text style={styles.metaText}>{item.bale_count} baloți</Text>
                </View>
                {item.status === 'arrived' && (
                  <Text style={styles.deliveryHint}>Apasă pentru livrare</Text>
                )}
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.emptyText}>Nicio cursă activă.</Text>
              <Text style={styles.emptySubtext}>Cursele asignate vor apărea aici.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    backgroundColor: '#0A5C36',
  },
  safeArea: {
    backgroundColor: '#0A5C36',
  },
  headerSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 12,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  body: {
    flex: 1,
    backgroundColor: '#F3DED8',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingTop: 40,
  },
  list: {
    padding: 16,
    gap: 12,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tripNumber: { fontSize: 16, fontWeight: '600', color: '#000' },
  badge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { color: '#FFF', fontSize: 12, fontWeight: '600' },
  destination: { fontSize: 14, color: '#5D4037' },
  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  meta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  metaText: { fontSize: 13, color: '#8D6E63' },
  deliveryHint: { fontSize: 12, color: '#0A5C36', fontWeight: '600' },
  emptyText: { fontSize: 15, color: '#374151', fontWeight: '500' },
  emptySubtext: { fontSize: 13, color: '#8D6E63' },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/app/(driver)/index.tsx
git commit -m "feat(mobile): two-tone header on driver trips screen"
```

---

## Task 15 — Loader home — two-tone header

**Files:**
- Modify: `apps/mobile/app/(loader)/index.tsx`

Title + subtitle + TaskList go in the green header. QR scanner and buttons in the beige body.

- [ ] **Step 1: Replace file**

```tsx
import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { QRScanner } from '@/components/shared/QRScanner';
import { BigButton } from '@/components/ui/BigButton';
import { OfflineBanner } from '@/components/shared/OfflineBanner';
import { TaskList } from '@/components/shared/TaskList';
import { ProblemReportModal } from '@/components/shared/ProblemReportModal';
import { useAuthStore } from '@/stores/auth-store';
import { useMyTasks } from '@/hooks/useMyTasks';

export default function LoaderScanScreen() {
  const assignedMachineId = useAuthStore((s) => s.assignedMachineId);
  const { tasks } = useMyTasks();
  const [problemModalVisible, setProblemModalVisible] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const handleScan = (data: string) => {
    setScanError(null);
    // Expected format: strawboss://truck/<truckId>
    const match = data.match(/strawboss:\/\/truck\/([a-zA-Z0-9-]+)/);
    if (match) {
      const truckId = match[1];
      router.push(`/loader-ops/load-bales?truckId=${truckId}`);
    } else {
      setScanError('Cod QR invalid. Scanați codul de pe camion.');
    }
  };

  return (
    <View style={styles.outerContainer}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <OfflineBanner />
        <View style={styles.headerSection}>
          <Text style={styles.title}>Scanează Camion</Text>
          <Text style={styles.subtitle}>
            Poziționați camera pe codul QR de pe camion
          </Text>
          <TaskList tasks={tasks} role="loader_operator" />
        </View>
      </SafeAreaView>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.content}
      >
        <View style={styles.scannerContainer}>
          <QRScanner onScan={handleScan} />
        </View>

        {scanError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{scanError}</Text>
          </View>
        ) : null}

        <View style={styles.divider}>
          <Text style={styles.dividerText}>sau</Text>
        </View>

        <BigButton
          title="Raportează problemă tehnică"
          onPress={() => setProblemModalVisible(true)}
          variant="outline"
        />
      </ScrollView>

      <ProblemReportModal
        visible={problemModalVisible}
        onClose={() => setProblemModalVisible(false)}
        machineId={assignedMachineId ?? undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    backgroundColor: '#0A5C36',
  },
  safeArea: {
    backgroundColor: '#0A5C36',
  },
  headerSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  body: {
    flex: 1,
    backgroundColor: '#F3DED8',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  content: {
    padding: 16,
    gap: 16,
  },
  scannerContainer: {
    height: 300,
    borderRadius: 12,
    overflow: 'hidden',
  },
  errorBox: {
    backgroundColor: '#FEE2E2',
    borderRadius: 8,
    padding: 12,
  },
  errorText: { color: '#991B1B', fontSize: 13 },
  divider: { alignItems: 'center' },
  dividerText: { color: '#8D6E63', fontSize: 13 },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/app/(loader)/index.tsx
git commit -m "feat(mobile): two-tone header on loader scan screen"
```

---

## Task 16 — ProfileScreen — two-tone with larger avatar

**Files:**
- Modify: `apps/mobile/src/components/ProfileScreen.tsx`

User identity (avatar, name, email, role badge) moves to the green header zone. Machine card and logout button are in the beige body. Avatar 72→88 px with semi-transparent border ring. Logout button height 60, borderRadius 16.

- [ ] **Step 1: Replace file**

```tsx
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import type { User, Machine } from '@strawboss/types';
import { mobileApiClient } from '@/lib/api-client';
import { getSupabaseClient } from '@/lib/auth';
import { useAuthStore } from '@/stores/auth-store';

const ROLE_LABEL: Record<string, string> = {
  driver:           'Șofer',
  loader_operator:  'Operator Încărcător',
  baler_operator:   'Operator Balotieră',
  admin:            'Administrator',
};

type MachineIconName = 'wrench' | 'grain' | 'truck' | 'map-marker';
const MACHINE_MDI: Record<string, MachineIconName> = {
  loader: 'wrench',
  baler:  'grain',
  truck:  'truck',
};

export function ProfileScreen() {
  const { clear } = useAuthStore();

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: () => mobileApiClient.get<User>('/api/v1/profile'),
  });

  const assignedMachineId = profile?.assignedMachineId ?? null;
  const { data: machine, isLoading: machineLoading } = useQuery({
    queryKey: ['machine', assignedMachineId],
    queryFn: () => mobileApiClient.get<Machine>(`/api/v1/machines/${assignedMachineId}`),
    enabled: !!assignedMachineId,
  });

  const handleLogout = async () => {
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
    clear();
  };

  const isLoading = profileLoading || (!!assignedMachineId && machineLoading);

  return (
    <View style={styles.outerContainer}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.headerSection}>
          {isLoading ? (
            <ActivityIndicator size="large" color="#FFFFFF" />
          ) : profile ? (
            <>
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarText}>
                  {profile.fullName?.charAt(0)?.toUpperCase() ?? '?'}
                </Text>
              </View>
              <Text style={styles.fullName}>{profile.fullName}</Text>
              <Text style={styles.email}>{profile.email}</Text>
              <View style={styles.roleBadge}>
                <Text style={styles.roleText}>
                  {ROLE_LABEL[profile.role] ?? profile.role}
                </Text>
              </View>
            </>
          ) : (
            <Text style={styles.errorText}>Nu s-au putut încărca datele profilului</Text>
          )}
        </View>
      </SafeAreaView>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.content}
      >
        {profile ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Mașina asignată</Text>
            {!assignedMachineId ? (
              <Text style={styles.noMachine}>Nicio mașină asignată</Text>
            ) : machine ? (
              <View style={styles.machineRow}>
                <MaterialCommunityIcons
                  name={MACHINE_MDI[machine.machineType] ?? 'map-marker'}
                  size={28}
                  color="#0A5C36"
                />
                <View>
                  <Text style={styles.machineCode}>{machine.internalCode}</Text>
                  <Text style={styles.machineDetail}>
                    {machine.make} {machine.model}
                  </Text>
                  {machine.registrationPlate ? (
                    <Text style={styles.machinePlate}>{machine.registrationPlate}</Text>
                  ) : null}
                </View>
              </View>
            ) : (
              <Text style={styles.noMachine}>Nu s-a putut încărca mașina</Text>
            )}
          </View>
        ) : null}

        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} activeOpacity={0.8}>
          <Text style={styles.logoutText}>Deconectare</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    backgroundColor: '#0A5C36',
  },
  safeArea: {
    backgroundColor: '#0A5C36',
  },
  headerSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
    alignItems: 'center',
    gap: 8,
  },
  avatarCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.4)',
  },
  avatarText: { fontSize: 36, fontWeight: '700', color: '#FFFFFF' },
  fullName: { fontSize: 22, fontWeight: '700', color: '#FFFFFF' },
  email: { fontSize: 14, color: 'rgba(255, 255, 255, 0.8)' },
  roleBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 5,
    marginTop: 4,
  },
  roleText: { fontSize: 13, fontWeight: '600', color: '#FFFFFF' },
  errorText: { fontSize: 14, color: 'rgba(255,255,255,0.8)', fontStyle: 'italic' },
  body: {
    flex: 1,
    backgroundColor: '#F3DED8',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  content: {
    padding: 16,
    gap: 16,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    gap: 8,
    alignItems: 'flex-start',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardTitle: { fontSize: 14, fontWeight: '600', color: '#5D4037' },
  machineRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  machineCode: { fontSize: 16, fontWeight: '700', color: '#0A5C36' },
  machineDetail: { fontSize: 13, color: '#5D4037' },
  machinePlate: { fontSize: 12, color: '#9ca3af' },
  noMachine: { fontSize: 14, color: '#8D6E63', fontStyle: 'italic' },
  logoutButton: {
    backgroundColor: '#C62828',
    borderRadius: 16,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  logoutText: { color: '#fff', fontSize: 17, fontWeight: '700', letterSpacing: 0.3 },
});
```

- [ ] **Step 2: Run final type-check and commit**

```bash
pnpm --filter @strawboss/mobile typecheck
git add apps/mobile/src/components/ProfileScreen.tsx
git commit -m "feat(mobile): two-tone header on ProfileScreen, larger avatar"
```

---

## Verification

After all 16 tasks:

```bash
# Type-check the mobile package
pnpm --filter @strawboss/mobile typecheck

# Start dev environment
./strawboss.sh dev
```

Visual inspection checklist:
- [ ] Login screen: full green background, white card centered, `eye`/`eye-off` icon on password field
- [ ] Baler/Driver/Loader home: green top, beige body slides up with rounded top corners
- [ ] Profile: green header with avatar + name, beige body with machine card
- [ ] Tab bar: height 72, shadow visible, active tab icon has green pill background
- [ ] BigButton: 60 px height, rounder corners
- [ ] NumericPad: keys are larger (72 px)
- [ ] StatusPill: uppercase labels
- [ ] TaskList: sequence number in green circle; urgent/high tasks have left red/orange border stripe
- [ ] OfflineBanner (when offline): wifi-off icon visible to left of text
- [ ] AlertBanner: left-side colored border stripe

---

## Potential Gotchas

1. **`TaskList` on green background**: TaskList white cards will contrast against the green header — this is intentional.
2. **`FlatList style` with `borderTopLeftRadius`**: This is a supported pattern on both iOS and Android. The radius clips the background, not the content.
3. **`tabBarLabelStyle fontWeight`**: If TypeScript complains about `'600'`, use `fontWeight: '600' as const`.
4. **`ProfileScreen` loading state**: The ActivityIndicator is now on a green background — white color makes it visible. The original used `color="#0A5C36"` which is invisible on green; the replacement uses `color="#FFFFFF"`.
5. **Driver home `centered` style**: When `loading === true`, the beige `View` needs `flex:1` — it gets this from `styles.body`. Ensure `[styles.body, styles.centered]` merges correctly (it does since `centered` only adds `justifyContent`/`alignItems`).
