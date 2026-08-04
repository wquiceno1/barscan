import type { SQLiteDatabase } from 'expo-sqlite';
import { nowIso } from './util';

// Efectivo contado por mes, para el salario del encargado. El efectivo estimado
// (ventas − compras − transporte) se calcula al vuelo en Reportes; esta tabla
// solo guarda el conteo manual opcional que lo sobreescribe.
export type CajaMensual = {
  mes: string; // 'YYYY-MM'
  efectivo_contado: number | null; // COP contado; null = usar el estimado
  inventario_cierre: number | null; // snapshot de inventario (a precio) al cierre
  base_efectivo: number | null; // préstamo/base del mes (raro); null = ninguno
  created_at: string;
  updated_at: string;
  synced: number;
};

/** Conteo de efectivo guardado para un mes ('YYYY-MM'); null si no hay. */
export async function getEfectivoContado(
  db: SQLiteDatabase,
  mes: string
): Promise<number | null> {
  const row = await db.getFirstAsync<{ efectivo_contado: number | null }>(
    'SELECT efectivo_contado FROM caja_mensual WHERE mes = ?',
    mes
  );
  return row?.efectivo_contado ?? null;
}

/**
 * Guarda/actualiza el conteo de efectivo de un mes. `monto = null` "vuelve al
 * estimado" (deja la fila con efectivo_contado NULL). Upsert; marca synced = 0.
 */
export async function setEfectivoContado(
  db: SQLiteDatabase,
  mes: string,
  monto: number | null
): Promise<void> {
  const ts = nowIso();
  await db.runAsync(
    `INSERT INTO caja_mensual (mes, efectivo_contado, created_at, updated_at, synced)
       VALUES (?, ?, ?, ?, 0)
     ON CONFLICT(mes) DO UPDATE SET
       efectivo_contado = excluded.efectivo_contado,
       updated_at       = excluded.updated_at,
       synced           = 0`,
    mes,
    monto == null ? null : Math.round(monto),
    ts,
    ts
  );
}

/** Mes anterior a `mes` ('YYYY-MM' → 'YYYY-MM'). */
function mesAnterior(mes: string): string {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Guarda el snapshot del valor de inventario (a precio) al cerrar `mes`. Es el
 * "inventario base" del mes siguiente. Upsert; marca synced = 0.
 */
export async function guardarCierreInventario(
  db: SQLiteDatabase,
  mes: string,
  valor: number
): Promise<void> {
  const ts = nowIso();
  await db.runAsync(
    `INSERT INTO caja_mensual (mes, inventario_cierre, created_at, updated_at, synced)
       VALUES (?, ?, ?, ?, 0)
     ON CONFLICT(mes) DO UPDATE SET
       inventario_cierre = excluded.inventario_cierre,
       updated_at        = excluded.updated_at,
       synced            = 0`,
    mes,
    Math.round(valor),
    ts,
    ts
  );
}

/** Inventario base de `mes` = el cierre guardado del mes anterior (null si no hay). */
export async function getInventarioBase(
  db: SQLiteDatabase,
  mes: string
): Promise<number | null> {
  const row = await db.getFirstAsync<{ inventario_cierre: number | null }>(
    'SELECT inventario_cierre FROM caja_mensual WHERE mes = ?',
    mesAnterior(mes)
  );
  return row?.inventario_cierre ?? null;
}
