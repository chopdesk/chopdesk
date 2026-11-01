// lib/brand.ts
// Single source of truth for platform branding.
// themeColor must match --color-primary in app/globals.css.
// Later, per-customer branding will override these values per tenant.
export const brand = {
  name: 'Chopdesk',
  themeColor: '#12566B',
  backgroundColor: '#FFFFFF',
  description: 'Restaurant Management System',
  icon: '/icon.svg',
} as const;
