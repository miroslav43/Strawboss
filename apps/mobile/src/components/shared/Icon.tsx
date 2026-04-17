import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

type MCIName = ComponentProps<typeof MaterialCommunityIcons>['name'];

interface IconProps {
  name: MCIName;
  size?: number;
  color?: string;
  accessibilityLabel?: string;
}

/**
 * Thin wrapper over MaterialCommunityIcons (Material Design Icons library).
 * Use this instead of raw emoji or unicode strings for all icons in the app.
 */
export function Icon({ name, size = 24, color, accessibilityLabel }: IconProps) {
  return (
    <MaterialCommunityIcons
      name={name}
      size={size}
      color={color}
      accessibilityLabel={accessibilityLabel}
      accessible={!!accessibilityLabel}
    />
  );
}
