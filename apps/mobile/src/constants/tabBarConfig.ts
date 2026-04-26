import { colors } from '@strawboss/ui-tokens';
import { scale } from '@/utils/responsive';

export function makeTabBarStyle(safeBottom: number) {
  const paddingBottom = Math.max(12, safeBottom);
  return {
    backgroundColor: colors.white,
    borderTopColor: colors.neutral100,
    height: scale(60) + paddingBottom,
    paddingBottom,
    paddingTop: 4,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 8,
  } as const;
}

export const tabBarLabelStyle = {
  fontSize: 11,
  fontWeight: '600' as const,
  marginTop: 2,
};

export const tabBarActiveTintColor = colors.primary;
export const tabBarInactiveTintColor = colors.tertiary;
