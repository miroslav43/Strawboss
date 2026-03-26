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
  planned: { bg: '#9E9E9E', text: '#FFFFFF' },
  loading: { bg: '#F59E0B', text: '#FFFFFF' },
  loaded: { bg: '#D97706', text: '#FFFFFF' },
  in_transit: { bg: '#1565C0', text: '#FFFFFF' },
  arrived: { bg: '#2196F3', text: '#FFFFFF' },
  delivering: { bg: '#2E7D32', text: '#FFFFFF' },
  delivered: { bg: '#1B5E20', text: '#FFFFFF' },
  completed: { bg: '#0A5C36', text: '#FFFFFF' },
  cancelled: { bg: '#C62828', text: '#FFFFFF' },
  disputed: { bg: '#C62828', text: '#FFFFFF' },
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
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  sm: {
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  text: {
    fontWeight: '600',
  },
  textMd: {
    fontSize: 13,
  },
  textSm: {
    fontSize: 11,
  },
});
