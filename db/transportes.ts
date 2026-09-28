import type { SQLiteDatabase } from 'expo-sqlite';
import { newId, nowIso } from './util';

// Costos de transporte (fletes): gasto puro, no toca inventario ni ventas.
export type Transporte = {
  id: string;
  fecha_hora: string;
  monto: number; // COP pagado
  transportador: string | null;
  detalle: string | null;
  foto: string | null; // reservado para la fase 2 (recibo)
  created_at: string;
  updated_at: string;
  synced: number;
};

export type NuevoTransporte = {
  monto: number;
  transportador?: string | null;
  detalle?: string | null;
  fecha_hora?: string; // por defecto, ahora
};

export async function crearTransporte(
  db: SQLiteDatabase,
  t: NuevoTransporte
): Promise<string> {
  const id = newId();
  const ts = nowIso();
  await db.runAsync(
    `INSERT INTO transportes
       (id, fecha_hora, monto, transportador, detalle, foto,
        created_at, updated_at, synced)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 0)`,
    id,
    t.fecha_hora ?? ts,
    Math.round(t.monto),
    t.transportador?.trim() || null,
    t.detalle?.trim() || null,
    ts,
    ts
  );
  return id;
}

/** Lista de transportes, más recientes primero. Opcionalmente por rango ISO. */
export async function listarTransportes(
  db: SQLiteDatabase,
  rango?: { desde: string; hasta: string }
): Promise<Transporte[]> {
  if (rango) {
    return db.getAllAsync<Transporte>(
      `SELECT * FROM transportes
        WHERE fecha_hora >= ? AND fecha_hora <= ?
        ORDER BY fecha_hora DESC`,
      rango.desde,
      rango.hasta
    );
  }
  return db.getAllAsync<Transporte>(
    'SELECT * FROM transportes ORDER BY fecha_hora DESC'
  );
}

/** Total pagado en transporte en un rango [desde, hasta] (ISO). */
export async function totalTransporte(
  db: SQLiteDatabase,
  rango: { desde: string; hasta: string }
): Promise<number> {
  const row = await db.getFirstAsync<{ total: number }>(
    `SELECT COALESCE(SUM(monto), 0) AS total
       FROM transportes
      WHERE fecha_hora >= ? AND fecha_hora <= ?`,
    rango.desde,
    rango.hasta
  );
  return row?.total ?? 0;
}

/**
 * Borra un registro de transporte (para corregir errores) y deja una lápida
 * para que el respaldo replique el borrado en Firestore (ver migración v7).
 * Sin ella, el registro seguiría en la nube y volvería al restaurar. Todo
 * atómico.
 */
export async function eliminarTransporte(
  db: SQLiteDatabase,
  id: string
): Promise<void> {
  const ts = nowIso();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM transportes WHERE id = ?', id);
    await db.runAsync(
      `INSERT OR REPLACE INTO eliminaciones
         (coleccion, doc_id, created_at, synced)
       VALUES ('transportes', ?, ?, 0)`,
      id,
      ts
    );
  });
}
