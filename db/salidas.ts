// Salidas sin venta: mercadería que sale del inventario sin ser una venta.
// Se persisten como transacciones tipo 'ajuste' distinguidas por `categoria`
// (+ `subcategoria` en deducciones). Restan stock, no cuentan como venta.

export const CATEGORIAS_SALIDA = ['colegio', 'deduccion'] as const;
export type CategoriaSalida = (typeof CATEGORIAS_SALIDA)[number];

// Categoría de una transacción. Además de las salidas (colegio/deducción), una
// devolución/cambio se persiste como `venta` con categoria = 'devolucion' y
// líneas de cantidad negativa (ver PLAN-DEVOLUCIONES.md).
export type CategoriaTx = CategoriaSalida | 'devolucion';

export const SUBCATS_DEDUCCION = [
  'aseo',
  'transporte',
  'vencido',
  'faltante',
] as const;
export type SubcatDeduccion = (typeof SUBCATS_DEDUCCION)[number];

export const LABEL_CATEGORIA: Record<CategoriaSalida, string> = {
  colegio: 'Colegio',
  deduccion: 'Deducción',
};

export const LABEL_SUBCAT: Record<SubcatDeduccion, string> = {
  aseo: 'Aseo / uso interno',
  transporte: 'Dañado en transporte',
  vencido: 'Vencido / caducado',
  faltante: 'Faltante / robo',
};

/** Nombre corto de una subcategoría (con fallback al código si es desconocida). */
export function labelSubcat(sub: string | null): string {
  if (!sub) return 'Deducción';
  return LABEL_SUBCAT[sub as SubcatDeduccion] ?? sub;
}

/**
 * Etiqueta legible de una transacción según su categoría de salida.
 * Devuelve null si no es una salida (ajuste normal, venta, compra).
 */
export function etiquetaSalida(
  categoria: string | null,
  subcategoria: string | null
): string | null {
  if (categoria === 'colegio') return 'Colegio';
  if (categoria === 'deduccion') return `Deducción · ${labelSubcat(subcategoria)}`;
  if (categoria === 'devolucion') return 'Devolución / Cambio';
  return null;
}
