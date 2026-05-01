// Centralised design tokens. All UI files import from here so the look-and-feel can be tuned in
// one place. Hard-coded hex values, font sizes, and weights in StyleSheet blocks should be
// replaced with references into `colors`, `fontFamilies`, and `typography`.

// --- COLOR PALETTE ----------------------------------------------------------
//
// Chosen to feel distinct from the previous bootstrap-blue / cool-gray scheme:
//   - Warm off-white surfaces (cream / stone) instead of cool gray.
//   - Deep teal brand instead of #007BFF blue.
//   - Burnt-orange warning, deeper emerald success, brick-red danger.
//   - Header chrome shifts from cool navy (#0D0D1A / #1A1A2E) to warm stone (#1C1917 / #292524).

export const colors = {
  // Base surfaces
  bg: '#F4F1EC',          // warm off-white (was #F8F9FA)
  surface: '#FFFFFF',
  surfaceAlt: '#FAF7F2',  // warm cream alt (was #F0F0F0)
  border: '#E5DED3',      // warm beige (was #E9ECEF / #CED4DA)

  // Dark chrome (header, drawer)
  darkBg: '#1C1917',      // stone-900 (was #0D0D1A)
  darkSurface: '#292524', // stone-800 (was #1A1A2E for chrome)

  // Text
  textPrimary: '#1F2937',     // slate-800 (was #1A1A2E text / #495057 / #333)
  textSecondary: '#6B7280',   // gray-500 (was #6C757D)
  textMuted: '#9CA3AF',       // gray-400 (was #ADB5BD)
  textPlaceholder: '#A8A29E', // warm gray (was #999)
  textOnBrand: '#FFFFFF',

  // Brand (deep teal — was #007BFF)
  brandPrimary: '#0E7490',
  brandPrimaryHover: '#0891B2',
  brandPrimaryLight: '#CFFAFE',       // tint bg (was #E7F3FF)
  brandPrimaryBorder: '#A5F3FC',      // tint border (was #B6D4FE)
  brandPrimaryAlpha15: 'rgba(14,116,144,0.15)', // active drawer item

  // Status — success (was #28A745)
  success: '#047857',     // emerald-700
  successBg: '#D1FAE5',   // emerald-100 (was #D4EDDA)
  successText: '#064E3B', // emerald-900 (was #155724)

  // Status — danger (was #DC3545)
  danger: '#B91C1C',      // red-700
  dangerBg: '#FEE2E2',    // red-100 (was #F8D7DA / #F5C6CB)
  dangerText: '#7F1D1D',  // red-900 (was #721C24 / #B4232A)

  // Status — warning (was #FD7E14)
  warning: '#C2410C',       // orange-700
  warningBg: '#FFEDD5',     // orange-100 (was #FFF3CD)
  warningBorder: '#FED7AA', // orange-200 (was #FFE69C)
  warningText: '#7C2D12',   // orange-900 (was #856404 / #664D03)

  // Other accents
  info: '#0284C7',   // sky-600 (was #17A2B8)
  accent: '#7C3AED', // violet-600 (was #6F42C1)

  // Utility
  black: '#000000',
  white: '#FFFFFF',
  shadow: 'rgba(0,0,0,0.3)',
  shadowSoft: 'rgba(0,0,0,0.1)',
  overlay: 'rgba(0,0,0,0.5)',
  drawerBorder: 'rgba(255,255,255,0.1)',
} as const;

// --- TYPOGRAPHY -------------------------------------------------------------
//
// `fontFamilies.display` resolves to `SpaceMono-Regular` once it's loaded by
// `useFonts` in `app/_layout.tsx`. Use it for brand text and token numerals to give
// the app a distinct geometric feel; body copy keeps the system default.

export const fontFamilies = {
  body: undefined as string | undefined,
  display: 'SpaceMono-Regular',
} as const;

export const typography = {
  // Font sizes — slightly tighter than the old set, with a clearer step.
  size: {
    xs: 11,
    sm: 13,
    base: 14,
    md: 15,
    lg: 16,
    xl: 18,
    h2: 20,
    h1: 22,
    display: 28,
  },

  // Weights as React Native string literals.
  weight: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
    extrabold: '800',
  } as const,

  // Letter-spacing scale — used on small caps / button labels / brand for definition.
  tracking: {
    tight: -0.2,
    normal: 0,
    wide: 0.3,
    wider: 0.5,
    widest: 1,
  },
} as const;
