import { Dimensions } from 'react-native';

const BASE_WIDTH = 390; // iPhone 15 baseline
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export { SCREEN_WIDTH, SCREEN_HEIGHT };
export const isTablet = SCREEN_WIDTH >= 768;

export const scale = (size: number): number => Math.round((size * SCREEN_WIDTH) / BASE_WIDTH);

// Cap at 1.5 to respect accessibility large-text settings while preventing
// extreme layout breakage on very wide devices.
export const fontScale = (size: number): number =>
  Math.round(size * Math.min(SCREEN_WIDTH / BASE_WIDTH, 1.5));
