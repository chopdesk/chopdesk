// lib/fonts.ts
// ─────────────────────────────────────────────
// TYPE SCALE — single source of truth
// To restyle the entire app: edit values here only.
// All CSS classes in globals.css reference these names.
// ─────────────────────────────────────────────

export const typeScale = {
  // Brand wordmark — splash + login header
  brand: {
    size: '28px',
    weight: '700',
    lineHeight: '1.1',
    letterSpacing: '-0.02em',
  },

  // Page titles, modal headers
  h1: {
    size: '28px',
    weight: '634',  // Geist variable font — maps to ~650, renders between semibold and bold
    lineHeight: '1.2',
    letterSpacing: '-0.01em',
  },

  // Section headings, card titles
  h2: {
    size: '22px',
    weight: '453',  // Geist variable font — maps to ~450, renders between regular and medium
    lineHeight: '1.3',
    letterSpacing: '-0.005em',
  },

  // Sub-section labels, list group headers
  h3: {
    size: '18px',
    weight: '295',  // Geist variable font — maps to ~300, light
    lineHeight: '1.4',
    letterSpacing: '0em',
  },

  // Standard UI text — labels, descriptions
  body: {
    size: '14px',
    weight: '400',
    lineHeight: '1.5',
    letterSpacing: '0em',
  },

  // Supporting text — timestamps, hints, captions
  small: {
    size: '12px',
    weight: '300',
    lineHeight: '1.5',
    letterSpacing: '0.01em',
  },

  // Buttons, tags, status badges
  label: {
    size: '13px',
    weight: '500',
    lineHeight: '1',
    letterSpacing: '0.02em',
  },

  // Financial figures, order IDs
  mono: {
    size: '14px',
    weight: '400',
    lineHeight: '1.5',
    letterSpacing: '0em',
  },
} as const