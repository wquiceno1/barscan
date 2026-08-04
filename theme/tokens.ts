// Tokens de diseño. Única fuente de verdad para color, espaciado y tipografía.
// Las pantallas y componentes deben consumir estos tokens, no valores sueltos.

export const colors = {
  // Marca / acentos
  primary: '#2563eb',
  primaryDark: '#1d4ed8',
  venta: '#16a34a',
  compra: '#2563eb',
  ajuste: '#d97706',
  salida: '#ee46c4', // salidas sin venta (colegio / deducciones)
  transporte: '#7c3aed', // costos de transporte (fletes)
  danger: '#dc2626',

  // Superficies
  bg: '#eef2f7', // fondo de la app (gris claro → da contraste a las tarjetas blancas)
  surface: '#ffffff',
  surfaceAlt: '#f9fafb',
  border: '#e5e7eb',

  // Texto
  text: '#0f172a',
  textMuted: '#64748b',
  textInverse: '#ffffff',

  // Estados
  overlay: 'rgba(15,23,42,0.5)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const font = {
  // tamaños
  xs: 12,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 26,
} as const;

// Sombra sutil y consistente para tarjetas (Android usa elevation).
export const shadow = {
  shadowColor: '#0f172a',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.06,
  shadowRadius: 3,
  elevation: 2,
} as const;
