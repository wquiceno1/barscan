import type { SQLiteDatabase } from 'expo-sqlite';
import { getConfig, getSalarioPct, setConfig } from './configuracion';
import {
  deducciones,
  salidasColegio,
  totalFaltantes,
  totalPorTipo,
  utilidadPeriodo,
  valorInventario,
} from './reportes';
import { totalTransporte } from './transportes';
import { newId, nowIso } from './util';

// Liquidación por período (trimestral, disparada a mano): cierra el lapso desde
// la última liquidación hasta hoy, calcula salario y cuadre sobre el acumulado,
// y guarda el snapshot como ancla del período siguiente.
export type Liquidacion = {
  id: string;
  fecha_hora: string; // cierre del período
  desde: string | null; // inicio (fecha de la liquidación anterior; null = primera)
  ventas: number;
  compras: number;
  transporte: number;
  colegio: number;
  deducciones: number;
  inversiones: number; // compras + transporte
  efectivo: number; // usado (contado o estimado)
  salario_base: number;
  salario_pct: number;
  salario: number;
  ganancia: number;
  inventario_cierre: number; // a precio
  inventario_base: number | null; // cierre de la liquidación anterior
  faltantes_valor: number;
  faltantes_cantidad: number;
  nota: string | null;
  created_at: string;
  updated_at: string;
  synced: number;
};

export type ResumenPeriodo = {
  inicio: string | null; // fecha de la última liquidación (null = primer período)
  desde: string; // rango efectivo de agregación
  hasta: string;
  mesesTranscurridos: number;
  ventas: number;
  compras: number;
  transporte: number;
  colegio: number;
  deducciones: number;
  inversiones: number; // compras + transporte
  efectivoEstimado: number; // ventas − compras − transporte
  ganancia: number;
  coberturaGanancia: number; // 0..1
  inventarioActual: number; // a precio
  inventarioBase: number | null; // cierre de la última liquidación
  faltantesValor: number;
  faltantesCantidad: number;
};

/** Diferencia en meses (de calendario) entre dos ISO. */
function mesesEntre(desdeIso: string, hastaIso: string): number {
  const a = new Date(desdeIso);
  const b = new Date(hastaIso);
  const m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  return Math.max(0, m);
}

/**
 * Inicio del período actual: la fecha de la última liquidación, o —si no hay
 * ninguna— la fecha de la primera transacción (para agregar todo el histórico).
 */
async function inicioPeriodo(
  db: SQLiteDatabase
): Promise<{ inicio: string | null; desde: string }> {
  const liq = await db.getFirstAsync<{ f: string | null }>(
    'SELECT MAX(fecha_hora) AS f FROM liquidaciones'
  );
  if (liq?.f) return { inicio: liq.f, desde: liq.f };
  const min = await db.getFirstAsync<{ f: string | null }>(
    'SELECT MIN(fecha_hora) AS f FROM transacciones'
  );
  return { inicio: null, desde: min?.f ?? '2000-01-01T00:00:00' };
}

/** Efectivo contado del período actual (borrador). null = usar el estimado. */
export async function getEfectivoPeriodo(
  db: SQLiteDatabase
): Promise<number | null> {
  const v = await getConfig(db, 'periodo_efectivo');
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Guarda el efectivo contado del período actual (null/'' = usar estimado). */
export async function setEfectivoPeriodo(
  db: SQLiteDatabase,
  monto: number | null
): Promise<void> {
  await setConfig(
    db,
    'periodo_efectivo',
    monto == null ? '' : String(Math.round(monto))
  );
}

/** Agregados del período actual (desde la última liquidación hasta ahora). */
export async function resumenPeriodo(
  db: SQLiteDatabase
): Promise<ResumenPeriodo> {
  const { inicio, desde } = await inicioPeriodo(db);
  const hasta = nowIso();

  const [ventas, compras, transporte, colegio, ded, util, inv, falt, base] =
    await Promise.all([
      totalPorTipo(db, 'venta', desde, hasta),
      totalPorTipo(db, 'compra', desde, hasta),
      totalTransporte(db, { desde, hasta }),
      salidasColegio(db, { desde, hasta }),
      deducciones(db, { desde, hasta }),
      utilidadPeriodo(db, desde, hasta),
      valorInventario(db),
      totalFaltantes(db, { desde, hasta }),
      db.getFirstAsync<{ inventario_cierre: number }>(
        'SELECT inventario_cierre FROM liquidaciones ORDER BY fecha_hora DESC LIMIT 1'
      ),
    ]);

  return {
    inicio,
    desde,
    hasta,
    mesesTranscurridos: mesesEntre(desde, hasta),
    ventas,
    compras,
    transporte,
    colegio: colegio.total,
    deducciones: ded.total,
    inversiones: compras + transporte,
    efectivoEstimado: ventas - compras - transporte,
    ganancia: util.utilidad,
    coberturaGanancia: util.cobertura,
    inventarioActual: inv.alPrecio,
    inventarioBase: base?.inventario_cierre ?? null,
    faltantesValor: falt.total,
    faltantesCantidad: falt.cantidad,
  };
}

/**
 * Cierra el período: calcula salario y cuadre sobre el acumulado, guarda la fila
 * en `liquidaciones` (snapshot + ancla del siguiente) y limpia el efectivo del
 * período. `efectivoContado` null = usar el estimado.
 */
export async function liquidarPeriodo(
  db: SQLiteDatabase,
  opts: { efectivoContado: number | null; nota?: string | null }
): Promise<Liquidacion> {
  const rp = await resumenPeriodo(db);
  const pct = await getSalarioPct(db);
  const efectivo = opts.efectivoContado ?? rp.efectivoEstimado;
  const salarioBase = efectivo + rp.inversiones;
  const salario = Math.round((salarioBase * pct) / 100);
  const ts = nowIso();

  const liq: Liquidacion = {
    id: newId(),
    fecha_hora: ts,
    desde: rp.inicio,
    ventas: rp.ventas,
    compras: rp.compras,
    transporte: rp.transporte,
    colegio: rp.colegio,
    deducciones: rp.deducciones,
    inversiones: rp.inversiones,
    efectivo,
    salario_base: salarioBase,
    salario_pct: pct,
    salario,
    ganancia: rp.ganancia,
    inventario_cierre: rp.inventarioActual,
    inventario_base: rp.inventarioBase,
    faltantes_valor: rp.faltantesValor,
    faltantes_cantidad: rp.faltantesCantidad,
    nota: opts.nota?.trim() || null,
    created_at: ts,
    updated_at: ts,
    synced: 0,
  };

  await db.runAsync(
    `INSERT INTO liquidaciones
       (id, fecha_hora, desde, ventas, compras, transporte, colegio,
        deducciones, inversiones, efectivo, salario_base, salario_pct, salario,
        ganancia, inventario_cierre, inventario_base, faltantes_valor,
        faltantes_cantidad, nota, created_at, updated_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    liq.id,
    liq.fecha_hora,
    liq.desde,
    liq.ventas,
    liq.compras,
    liq.transporte,
    liq.colegio,
    liq.deducciones,
    liq.inversiones,
    liq.efectivo,
    liq.salario_base,
    liq.salario_pct,
    liq.salario,
    liq.ganancia,
    liq.inventario_cierre,
    liq.inventario_base,
    liq.faltantes_valor,
    liq.faltantes_cantidad,
    liq.nota,
    liq.created_at,
    liq.updated_at
  );
  await setEfectivoPeriodo(db, null);
  return liq;
}

/** Liquidaciones anteriores, más recientes primero. */
export async function listarLiquidaciones(
  db: SQLiteDatabase
): Promise<Liquidacion[]> {
  return db.getAllAsync<Liquidacion>(
    'SELECT * FROM liquidaciones ORDER BY fecha_hora DESC'
  );
}
