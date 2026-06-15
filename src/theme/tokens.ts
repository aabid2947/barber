import { Platform, TextStyle, ViewStyle } from 'react-native';

/**
 * Quevix "Workbench" design system.
 *
 * A warm, monochromatic earth-toned aesthetic for a barbershop front desk — the
 * "friendly utility" voice of a household tool, not a clinical corporate app. The
 * system sits on a stark-white canvas, draws structure with hand-drawn-feeling
 * hairline bronze borders (line-art, not heavy shadow), carries one muted bronze
 * accent on CTAs/icons/illustration, and sets type in a neutral charcoal that
 * complements the bronze without competing. Geometry stays rounded; hit areas large.
 */

// ---------------------------------------------------------------------------
// Color — a stark-white canvas, warm sepia structure, one bronze accent.
// ---------------------------------------------------------------------------
export const palette = {
  // Canvas + surfaces (stark white background; warm cream for recessed/inset work)
  canvas: '#FFFFFF', // app background — clean, stark white (the line-art canvas)
  canvasDeep: '#FBF6EE', // recessed wells / scroll underlays — barely-warm cream
  surface: '#FFFFFF', // cards, sheets — white, defined by hairline borders
  surfaceMuted: '#F7F1E7', // inset fields, resting controls — warm cream
  surfaceSunken: '#F0E7D6', // pressed insets, track backgrounds

  // Structural lines (warm sepia hairlines — these draw the layout, line-art style)
  line: '#ECE3D4',
  lineStrong: '#DCCFB8',

  // Ink (neutral charcoal — complements bronze, never competes)
  ink: '#333333', // primary text
  inkMuted: '#6E6456', // secondary text — warm grey
  inkFaint: '#9C9484', // tertiary text / placeholders
  inkDisabled: '#C4BCAC',

  // Accent — warm, muted bronze/sepia. The dominant brand color: CTAs, icons, line-art.
  accent: '#8A6D3B',
  accentPressed: '#6F5730',
  accentInk: '#7A5E2C', // bronze used as text on light (deepened for legibility)
  accentSoft: '#F4EBD9', // tinted chips / selected backgrounds — warm cream
  accentSoftLine: '#E4D3AF',

  // Semantic — earthy, monochromatic-friendly tints with high-contrast text
  liveTeal: '#4E7C6F', // serving / "now" / live → muted pine (earthy "go")
  liveTealSoft: '#E6F0EC',
  liveTealLine: '#CADFD7',

  okGreen: '#5F7D4C', // done / success → olive
  okGreenSoft: '#EDF1E2',

  warnAmber: '#B5712F', // waiting / pending → warm clay/ochre (text-grade)
  warnAmberSoft: '#FAF0DF',
  warnAmberLine: '#EEDBB7',

  dangerRose: '#B14A3A', // destructive / leave → warm brick red
  dangerRoseSoft: '#F8E8E2',
  dangerRoseLine: '#EECABB',

  white: '#FFFFFF',
} as const;

// Warm bronze-brown shadow — soft, diffuse, sparing (borders do most of the work).
const SHADOW = '#6B4F22';

// ---------------------------------------------------------------------------
// Elevation — restrained, warm shadows. On the line-art system depth is a whisper;
// hairline borders carry hierarchy, so shadows stay light and bronze-tinted.
// ---------------------------------------------------------------------------
type Elevation = ViewStyle;

export const elevation: Record<'flat' | 'sm' | 'md' | 'lg' | 'xl', Elevation> = {
  flat: {},
  sm: {
    shadowColor: SHADOW,
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  md: {
    shadowColor: SHADOW,
    shadowOpacity: 0.07,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  lg: {
    shadowColor: SHADOW,
    shadowOpacity: 0.1,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 14 },
    elevation: 8,
  },
  xl: {
    shadowColor: SHADOW,
    shadowOpacity: 0.13,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 20 },
    elevation: 16,
  },
};

// ---------------------------------------------------------------------------
// Spacing — generous, on a 4pt base. Whitespace is a feature here.
// ---------------------------------------------------------------------------
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
  '5xl': 56,
  '6xl': 72,
} as const;

// ---------------------------------------------------------------------------
// Radius — rounded, friendly geometry throughout.
// ---------------------------------------------------------------------------
export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  '2xl': 30,
  pill: 999,
} as const;

// Min touch targets — large, daylight-operation friendly.
export const hit = {
  control: 52,
  controlLg: 58,
  chip: 44,
} as const;

// ---------------------------------------------------------------------------
// Typography — high contrast, clean system font with a clinical "label" voice.
// ---------------------------------------------------------------------------
const numberFont = Platform.select({ ios: 'System', android: 'sans-serif-medium', default: 'System' });

export const type = {
  // Big numerals (token numbers, hero counts) — tabular for stable alignment.
  display: {
    fontSize: 64,
    lineHeight: 66,
    fontWeight: '800',
    color: palette.ink,
    fontVariant: ['tabular-nums'],
    letterSpacing: -1.5,
  } as TextStyle,
  titleXl: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    color: palette.ink,
    letterSpacing: -0.5,
  } as TextStyle,
  title: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    color: palette.ink,
    letterSpacing: -0.3,
  } as TextStyle,
  heading: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    color: palette.ink,
    letterSpacing: -0.2,
  } as TextStyle,
  body: {
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '500',
    color: palette.ink,
  } as TextStyle,
  bodyMuted: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
    color: palette.inkMuted,
  } as TextStyle,
  small: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    color: palette.inkMuted,
  } as TextStyle,
  // Eyebrow / clinical label voice — upper, tracked, muted.
  label: {
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '700',
    color: palette.inkFaint,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  } as TextStyle,
  numberMono: {
    fontFamily: numberFont,
    fontVariant: ['tabular-nums'],
  } as TextStyle,
} as const;

export const theme = { palette, elevation, space, radius, hit, type };
export type Theme = typeof theme;
