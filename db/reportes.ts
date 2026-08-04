import type { SQLiteBindValue, SQLiteDatabase } from 'expo-sqlite';

/** Valor del inventario: al costo (inversión) y al precio de venta (potencial). */
export async function valorInventario(
  db: SQLiteDatabase
): Promise<{ alCosto: number; alPrecio: number }> {
  const row = await db.getFirstAsync<{ alCosto: number; alPrecio: number }>(
    `SELECT
       COALESCE(SUM(stock_actual * COALESCE(costo, 0)), 0) AS alCosto,
       COALESCE(SUM(stock_actual * precio), 0)             AS alPrecio
     FROM productos WHERE activo = 1`
  );
  return row ?? { alCosto: 0, alPrecio: 0 };
}

/**
 * Faltantes (descuadres del chequeo de inventario) en un rango [desde, hasta]
 * (ISO): valor neto (a precio; negativo = faltante) y cantidad de descuadres.
 */
export async function totalFaltantes(
  db: SQLiteDatabase,
  rango: { desde: string; hasta: string }
): Promise<{ total: number; cantidad: number }> {
  const row = await db.getFirstAsync<{ total: number; cantidad: number }>(
    `SELECT COALESCE(SUM(diff_valor), 0) AS total, COUNT(*) AS cantidad
       FROM faltantes WHERE fecha_hora >= ? AND fecha_hora <= ?`,
    rango.desde,
    rango.hasta
  );
  return { total: row?.total ?? 0, cantidad: row?.cantidad ?? 0 };
}

/** Total de ventas o compras en un rango [desde, hasta] (ISO). Ignora ajustes. */
export async function totalPorTipo(
  db: SQLiteDatabase,
  tipo: 'venta' | 'compra',
  desde: string,
  hasta: string
): Promise<number> {
  const row = await db.getFirstAsync<{ total: number }>(
    `SELECT COALESCE(SUM(total), 0) AS total
       FROM transacciones
      WHERE tipo = ? AND fecha_hora >= ? AND fecha_hora <= ?`,
    tipo,
    desde,
    hasta
  );
  return row?.total ?? 0;
}

export type ResumenDia = {
  total: number; // COP vendidos en el día (todas las ventas)
  utilidad: number; // solo sobre líneas con costo conocido (ver cobertura)
  cobertura: number; // 0..1: fracción del monto vendido con costo conocido
};

/**
 * Resumen de ventas de un día concreto ('YYYY-MM-DD'). Ignora compras/ajustes.
 *
 * La utilidad se calcula SOLO sobre las líneas con `costo_snapshot` conocido:
 * un producto sin costo (null) no es un producto gratis, así que contarlo como
 * costo 0 inflaría la utilidad. `cobertura` indica qué parte del monto vendido
 * sí tiene costo, para que el número sea interpretable. El costo se va llenando
 * a medida que los productos se reponen (compras).
 */
export async function resumenVentasDia(
  db: SQLiteDatabase,
  dia: string
): Promise<ResumenDia> {
  const desde = `${dia}T00:00:00`;
  const hasta = `${dia}T23:59:59`;

  const cab = await db.getFirstAsync<{ total: number }>(
    `SELECT COALESCE(SUM(total), 0) AS total
       FROM transacciones
      WHERE tipo = 'venta' AND fecha_hora >= ? AND fecha_hora <= ?`,
    desde,
    hasta
  );

  const det = await db.getFirstAsync<{
    ingresos: number;
    ingresosConCosto: number;
    costo: number;
  }>(
    `SELECT
       COALESCE(SUM(i.subtotal), 0) AS ingresos,
       COALESCE(SUM(CASE WHEN i.costo_snapshot IS NOT NULL
                         THEN i.subtotal ELSE 0 END), 0) AS ingresosConCosto,
       COALESCE(SUM(CASE WHEN i.costo_snapshot IS NOT NULL
                         THEN i.cantidad * i.costo_snapshot ELSE 0 END), 0) AS costo
     FROM transaccion_items i
     JOIN transacciones t ON t.id = i.transaccion_id
     WHERE t.tipo = 'venta' AND t.fecha_hora >= ? AND t.fecha_hora <= ?`,
    desde,
    hasta
  );

  const ingresos = det?.ingresos ?? 0;
  const ingresosConCosto = det?.ingresosConCosto ?? 0;
  const costo = det?.costo ?? 0;
  return {
    total: cab?.total ?? 0,
    utilidad: ingresosConCosto - costo,
    cobertura: ingresos > 0 ? ingresosConCosto / ingresos : 0,
  };
}

/**
 * Utilidad del período (ventas − costo de lo vendido). Igual que
 * `resumenVentasDia`, solo considera las líneas con `costo_snapshot` conocido y
 * reporta la `cobertura` (fracción del monto con costo) para que la utilidad no
 * quede inflada por los productos sin costo cargado.
 */
export async function utilidadPeriodo(
  db: SQLiteDatabase,
  desde: string,
  hasta: string
): Promise<{
  ingresos: number;
  costo: number;
  utilidad: number;
  cobertura: number;
}> {
  const row = await db.getFirstAsync<{
    ingresos: number;
    ingresosConCosto: number;
    costo: number;
  }>(
    `SELECT
       COALESCE(SUM(i.subtotal), 0) AS ingresos,
       COALESCE(SUM(CASE WHEN i.costo_snapshot IS NOT NULL
                         THEN i.subtotal ELSE 0 END), 0) AS ingresosConCosto,
       COALESCE(SUM(CASE WHEN i.costo_snapshot IS NOT NULL
                         THEN i.cantidad * i.costo_snapshot ELSE 0 END), 0) AS costo
     FROM transaccion_items i
     JOIN transacciones t ON t.id = i.transaccion_id
     WHERE t.tipo = 'venta' AND t.fecha_hora >= ? AND t.fecha_hora <= ?`,
    desde,
    hasta
  );
  const ingresos = row?.ingresos ?? 0;
  const ingresosConCosto = row?.ingresosConCosto ?? 0;
  const costo = row?.costo ?? 0;
  return {
    ingresos,
    costo,
    utilidad: ingresosConCosto - costo,
    cobertura: ingresos > 0 ? ingresosConCosto / ingresos : 0,
  };
}

export type FilaInventarioInicial = {
  barcode: string;
  nombre: string;
  stock_inicial: number;
  precio: number;
  valor_total: number;
};

/**
 * Inventario con el que arrancó la tienda, valorizado a precio de venta.
 *
 * Solo productos activos con stock inicial > 0. El stock inicial se reconstruye
 * como `stock_actual − compras + ventas` (Opción B): ignora TODOS los ajustes,
 * incluidas las correcciones posteriores, porque `crearProducto` registra el
 * stock de arranque como un `ajuste` ('inventario inicial') y no como columna.
 * El valor por fila y el gran total se calculan en JS (`stock_inicial * precio`).
 */
export async function inventarioInicial(
  db: SQLiteDatabase
): Promise<{ filas: FilaInventarioInicial[]; total: number }> {
  const rows = await db.getAllAsync<{
    barcode: string;
    nombre: string;
    precio: number;
    stock_inicial: number;
  }>(
    `SELECT
       p.barcode,
       p.nombre,
       p.precio,
       p.stock_actual - COALESCE(mov.compras, 0) + COALESCE(mov.ventas, 0)
         AS stock_inicial
     FROM productos p
     LEFT JOIN (
       SELECT i.barcode,
              SUM(CASE WHEN t.tipo = 'compra' THEN i.cantidad ELSE 0 END) AS compras,
              SUM(CASE WHEN t.tipo = 'venta'  THEN i.cantidad ELSE 0 END) AS ventas
       FROM transaccion_items i
       JOIN transacciones t ON t.id = i.transaccion_id
       GROUP BY i.barcode
     ) mov ON mov.barcode = p.barcode
     WHERE p.activo = 1
       AND (p.stock_actual - COALESCE(mov.compras, 0) + COALESCE(mov.ventas, 0)) > 0
     ORDER BY p.nombre COLLATE NOCASE`
  );

  let total = 0;
  const filas = rows.map((r) => {
    const valor_total = r.stock_inicial * r.precio;
    total += valor_total;
    return {
      barcode: r.barcode,
      nombre: r.nombre,
      stock_inicial: r.stock_inicial,
      precio: r.precio,
      valor_total,
    };
  });
  return { filas, total };
}

export type FilaVenta = {
  barcode: string;
  nombre: string;
  unidades: number;
  precio_prom: number;
  total: number;
};

/**
 * Productos vendidos, agrupados por código y ordenados por unidades (desc).
 * Sin `rango` es el histórico completo; con `rango` se limita al período
 * [desde, hasta] (ISO). El total sale siempre de la suma real de subtotales;
 * `precio_prom = round(total / unidades)`. El nombre usa el catálogo actual y,
 * si el producto ya no existe, cae al `nombre_snapshot` de la venta.
 */
export async function productosVendidos(
  db: SQLiteDatabase,
  rango?: { desde: string; hasta: string }
): Promise<{ filas: FilaVenta[]; total: number }> {
  const params: SQLiteBindValue[] = [];
  let filtro = '';
  if (rango) {
    filtro = ' AND t.fecha_hora >= ? AND t.fecha_hora <= ?';
    params.push(rango.desde, rango.hasta);
  }

  const rows = await db.getAllAsync<{
    barcode: string;
    nombre: string;
    unidades: number;
    total: number;
  }>(
    `SELECT
       i.barcode,
       COALESCE(p.nombre, i.nombre_snapshot) AS nombre,
       SUM(i.cantidad) AS unidades,
       SUM(i.subtotal) AS total
     FROM transaccion_items i
     JOIN transacciones t ON t.id = i.transaccion_id
     LEFT JOIN productos p ON p.barcode = i.barcode
     WHERE t.tipo = 'venta'${filtro}
     GROUP BY i.barcode
     ORDER BY unidades DESC`,
    ...params
  );

  let total = 0;
  const filas = rows.map((r) => {
    total += r.total;
    return {
      barcode: r.barcode,
      nombre: r.nombre,
      unidades: r.unidades,
      precio_prom: r.unidades > 0 ? Math.round(r.total / r.unidades) : 0,
      total: r.total,
    };
  });
  return { filas, total };
}

/**
 * Salidas sin venta entregadas al colegio en un rango [desde, hasta] (ISO).
 * Valorizadas a precio de venta (el `subtotal` guardado). No son ventas.
 */
export async function salidasColegio(
  db: SQLiteDatabase,
  rango: { desde: string; hasta: string }
): Promise<{ unidades: number; total: number }> {
  const row = await db.getFirstAsync<{ unidades: number; total: number }>(
    `SELECT COALESCE(SUM(i.cantidad), 0)  AS unidades,
            COALESCE(SUM(i.subtotal), 0)  AS total
       FROM transaccion_items i
       JOIN transacciones t ON t.id = i.transaccion_id
      WHERE t.categoria = 'colegio'
        AND t.fecha_hora >= ? AND t.fecha_hora <= ?`,
    rango.desde,
    rango.hasta
  );
  return { unidades: row?.unidades ?? 0, total: row?.total ?? 0 };
}

export type FilaDeduccion = {
  subcategoria: string;
  unidades: number;
  total: number;
};

/**
 * Deducciones (bajas internas) en un rango [desde, hasta] (ISO), desglosadas por
 * subcategoría y ordenadas por valor. Valorizadas a precio de venta.
 */
export async function deducciones(
  db: SQLiteDatabase,
  rango: { desde: string; hasta: string }
): Promise<{ filas: FilaDeduccion[]; total: number }> {
  const filas = await db.getAllAsync<FilaDeduccion>(
    `SELECT t.subcategoria             AS subcategoria,
            COALESCE(SUM(i.cantidad), 0)  AS unidades,
            COALESCE(SUM(i.subtotal), 0)  AS total
       FROM transaccion_items i
       JOIN transacciones t ON t.id = i.transaccion_id
      WHERE t.categoria = 'deduccion'
        AND t.fecha_hora >= ? AND t.fecha_hora <= ?
      GROUP BY t.subcategoria
      ORDER BY total DESC`,
    rango.desde,
    rango.hasta
  );
  const total = filas.reduce((acc, f) => acc + f.total, 0);
  return { filas, total };
}
