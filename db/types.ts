// Tipos del dominio. El dinero es SIEMPRE entero en pesos colombianos (COP).
// Las fechas son strings ISO 8601 local: 'YYYY-MM-DDTHH:mm:ss'.

import type { CategoriaTx, SubcatDeduccion } from './salidas';

export type TipoTransaccion = 'compra' | 'venta' | 'ajuste';
export type ModoPrecio = 'margen' | 'fijo';

export type Producto = {
  barcode: string; // EAN/UPC real o interno 'INT-000123' para granel
  nombre: string;
  sin_codigo: number; // 0 | 1 (granel / sin código de barras)
  categoria: string | null;
  modo_precio: ModoPrecio;
  costo: number | null; // COP
  margen_pct: number | null; // override; null = usa configuracion.margen_general_pct
  precio: number; // COP, precio de venta vigente
  stock_actual: number;
  activo: number; // 0 | 1 (borrado lógico)
  ultimo_conteo: string | null; // ISO local del último chequeo físico; null = nunca
  created_at: string;
  updated_at: string;
  synced: number; // 0 | 1
};

export type Transaccion = {
  id: string; // UUID
  tipo: TipoTransaccion;
  fecha_hora: string;
  cliente_proveedor: string | null;
  motivo: string | null; // 'ajuste': motivo/nota libre
  // Salida sin venta ('ajuste' + colegio/deducción) o devolución/cambio ('venta'
  // + 'devolucion'). null = venta/compra/ajuste normal.
  categoria: CategoriaTx | null;
  subcategoria: SubcatDeduccion | null; // solo deducción
  total: number; // COP. 0 en ajuste de corrección; > 0 en salidas categorizadas
  created_at: string;
  updated_at: string;
  synced: number;
};

export type TransaccionItem = {
  id: string; // UUID
  transaccion_id: string;
  barcode: string;
  nombre_snapshot: string;
  cantidad: number; // >0 en compra/venta; ± en ajuste
  costo_snapshot: number | null; // COP al momento de la operación
  precio_unitario_snapshot: number; // COP al momento de la operación
  subtotal: number; // cantidad * precio_unitario_snapshot
  synced: number;
};

// Línea en construcción dentro de una sesión de transacción (antes de persistir).
export type LineaBorrador = {
  barcode: string;
  nombre: string;
  cantidad: number;
  costo_snapshot: number | null;
  precio_unitario_snapshot: number;
  // Solo UI (ajuste de inventario): stock vigente al agregar el producto, para
  // mostrar "stock actual" y "stock resultante". No se persiste.
  stock_actual?: number;
  // Solo UI (compra): margen propio del producto, para recalcular el precio
  // sugerido en vivo sin volver a consultar la base.
  margen_pct_snapshot?: number | null;
  // Solo UI (compra): precio de venta sugerido/confirmado, editable para
  // redondear. Se persiste como el nuevo precio del producto al finalizar.
  precio_venta_snapshot?: number;
};
