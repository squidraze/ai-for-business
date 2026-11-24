import { useColorScheme } from 'react-native';

const light = {
  scheme: 'light' as 'light' | 'dark',
  bg: '#f4f4f5',
  card: '#ffffff',
  text: '#18181b',
  muted: '#71717a',
  border: '#e4e4e7',
  primary: '#1f7bd1',
  primaryText: '#ffffff',
  danger: '#dc2626',
  inputBg: '#f4f4f5',
  bubbleIn: '#ffffff',
  bubbleOut: '#1f7bd1',
  bubbleOutText: '#ffffff',
  badge: '#1f7bd1',
  skeleton: '#e4e4e7',
  skeletonHighlight: 'rgba(255,255,255,0.75)',
  success: '#16a34a',
  successBg: 'rgba(34,197,94,0.15)',
  dangerBg: 'rgba(220,38,38,0.08)',
};

const dark: typeof light = {
  scheme: 'dark',
  bg: '#09090b',
  card: '#18181b',
  text: '#fafafa',
  muted: '#a1a1aa',
  border: '#27272a',
  primary: '#3b8fe0',
  primaryText: '#ffffff',
  danger: '#f87171',
  inputBg: '#27272a',
  bubbleIn: '#27272a',
  bubbleOut: '#1f7bd1',
  bubbleOutText: '#ffffff',
  badge: '#3b8fe0',
  skeleton: '#27272a',
  skeletonHighlight: 'rgba(255,255,255,0.07)',
  success: '#4ade80',
  successBg: 'rgba(74,222,128,0.15)',
  dangerBg: 'rgba(248,113,113,0.12)',
};

export type Colors = typeof light;

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}

export function useThemeName(): 'light' | 'dark' {
  return useColorScheme() === 'dark' ? 'dark' : 'light';
}
