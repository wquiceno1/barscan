import type { SQLiteBindValue, SQLiteDatabase } from 'expo-sqlite';
import type { Producto } from './types';
import { finalizarTransaccion } from './transacciones';
import { newId, nowIso } from './util';

// Chequeo de inventario por rotación (cuadre mensual). Un `faltante` es un
// descuadre detectado al contar físicamente un producto: el libro se sana con un
// ajuste de corrección y aquí queda el registro con estado de resolución.
export type Faltante = {
  id: string;
  barcode: string;
  nombre_snapshot: string;
  mes: string; // 'YYYY-MM'
  fecha_hora: string;
  esperado: number; // stock de libro al contar
  contado: number;
  diff_unidades: number; // contado - esperado (negativo = faltante)
  diff_valor: number; // diff_unidades * precio (a precio de venta)
  ajuste_id: string | null; // transaccion 'ajuste' que sanó el libro
  resuelto: number; // 0 | 1
  resolucion_nota: string | null;
  created_at: string;
  updated_at: string;
  synced: number;
};

/** 'YYYY-MM' del momento actual. */
function mesActual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Muestra del chequeo por rotación: productos activos con stock, ordenados por
 * `ultimo_conteo` más viejo primero (SQLite ordena NULL —nunca contados— primero
 * en ASC). Limitada a `muestra` productos.
 */
export async function productosParaContar(
  db: SQLiteDatabase,
  muestra: number
): Promise<Producto[]> {
  return db.getAllAsync<Producto>(
    `SELECT * FROM productos
       WHERE activo = 1 AND stock_actual > 0
       ORDER BY ultimo_conteo ASC, nombre COLLATE NOCASE ASC
       LIMIT ?`,
    Math.max(1, Math.round(muestra))
  );
}

/**
 * Registra el conteo físico de un producto. Siempre marca `ultimo_conteo` (para
 * la rotación). Si el conteo no cuadra con el stock de libro, sana el libro con
 * un ajuste de corrección (cantidad con signo, total 0 → no toca reportes de
 * dinero) y crea la fila en `faltantes`. Devuelve el faltante, o null si cuadró.
 */
export async function registrarConteo(
  db: SQLiteDatabase,
  barcode: string,
  contado: number
): Promise<Faltante | null> {
  const prod = await db.getFirstAsync<Producto>(
    'SELECT * FROM productos WHERE barcode = ?',
    barcode
  );
  if (!prod) throw new Error('Producto no encontrado.');

  const esperado = prod.stock_actual;
  const contadoInt = Math.max(0, Math.round(contado));
  const diff = contadoInt - esperado;
  const ts = nowIso();
  const marcarContado = () =>
    db.runAsync(
      'UPDATE productos SET ultimo_conteo = ?, updated_at = ?, synced = 0 WHERE barcode = ?',
      ts,
      ts,
      barcode
    );

  if (diff === 0) {
    await marcarContado();
    return null;
  }

  // Descuadre: sanar el libro con un ajuste de corrección. `finalizarTransaccion`
  // aplica el delta (= cantidad para un ajuste) → stock_actual pasa a ser el
  // contado, con total 0 al ser corrección (sin categoría).
  const ajusteId = await finalizarTransaccion(db, {
    tipo: 'ajuste',
    motivo: `Chequeo de inventario ${mesActual()}`,
    lineas: [
      {
        barcode,
        nombre: prod.nombre,
        cantidad: diff,
        costo_snapshot: prod.costo ?? null,
        precio_unitario_snapshot: prod.precio,
      },
    ],
  });
  await marcarContado();

  const faltante: Faltante = {
    id: newId(),
    barcode,
    nombre_snapshot: prod.nombre,
    mes: mesActual(),
    fecha_hora: ts,
    esperado,
    contado: contadoInt,
    diff_unidades: diff,
    diff_valor: diff * prod.precio,
    ajuste_id: ajusteId,
    resuelto: 0,
    resolucion_nota: null,
    created_at: ts,
    updated_at: ts,
    synced: 0,
  };

  await db.runAsync(
    `INSERT INTO faltantes
       (id, barcode, nombre_snapshot, mes, fecha_hora, esperado, contado,
        diff_unidades, diff_valor, ajuste_id, resuelto, resolucion_nota,
        created_at, updated_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, 0)`,
    faltante.id,
    faltante.barcode,
    faltante.nombre_snapshot,
    faltante.mes,
    faltante.fecha_hora,
    faltante.esperado,
    faltante.contado,
    faltante.diff_unidades,
    faltante.diff_valor,
    faltante.ajuste_id,
    faltante.created_at,
    faltante.updated_at
  );

  return faltante;
}

/** Faltantes de un mes y/o solo los pendientes. Pendientes primero, recientes antes. */
export async function listarFaltantes(
  db: SQLiteDatabase,
  filtro: { mes?: string; soloPendientes?: boolean } = {}
): Promise<Faltante[]> {
  const where: string[] = [];
  const params: SQLiteBindValue[] = [];
  if (filtro.mes) {
    where.push('mes = ?');
    params.push(filtro.mes);
  }
  if (filtro.soloPendientes) {
    where.push('resuelto = 0');
  }
  const sql =
    'SELECT * FROM faltantes' +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY resuelto ASC, fecha_hora DESC';
  return db.getAllAsync<Faltante>(sql, ...params);
}

/** Marca un faltante como resuelto, con nota (quién paga / cómo se manejó). */
export async function resolverFaltante(
  db: SQLiteDatabase,
  id: string,
  nota: string
): Promise<void> {
  const ts = nowIso();
  await db.runAsync(
    `UPDATE faltantes
       SET resuelto = 1, resolucion_nota = ?, updated_at = ?, synced = 0
     WHERE id = ?`,
    nota.trim() || null,
    ts,
    id
  );
}

/**
 * Cobertura del catálogo: cuántos productos contables (activos con stock) tienen
 * al menos un conteo registrado, sobre el total. Con la rotación, tiende a 100%.
 */
export async function progresoCiclo(
  db: SQLiteDatabase
): Promise<{ contados: number; total: number }> {
  const total = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM productos WHERE activo = 1 AND stock_actual > 0'
  );
  const contados = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM productos
       WHERE activo = 1 AND stock_actual > 0 AND ultimo_conteo IS NOT NULL`
  );
  return { contados: contados?.n ?? 0, total: total?.n ?? 0 };
}
