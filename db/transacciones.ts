import type { SQLiteBindValue, SQLiteDatabase } from 'expo-sqlite';
import type {
  LineaBorrador,
  TipoTransaccion,
  Transaccion,
  TransaccionItem,
} from './types';
import type { CategoriaTx, SubcatDeduccion } from './salidas';
import { newId, normalizarBusqueda, nowIso, sqlNormalizar } from './util';

export type NuevaTransaccion = {
  tipo: TipoTransaccion;
  cliente_proveedor?: string | null;
  motivo?: string | null;
  // Salida sin venta (colegio/deducción): se guarda como 'ajuste' pero con
  // categoría; resta stock y su `total` es el valor de lo que salió.
  // Devolución/cambio: 'venta' + categoria 'devolucion' con líneas negativas.
  categoria?: CategoriaTx | null;
  subcategoria?: SubcatDeduccion | null;
  lineas: LineaBorrador[];
};

/** Delta de stock que aplica una línea según el tipo de transacción. */
function deltaStock(
  tipo: TipoTransaccion,
  cantidad: number,
  esSalida: boolean
): number {
  if (tipo === 'venta') return -cantidad;
  if (esSalida) return -cantidad; // salida categorizada: unidades positivas que restan
  return cantidad; // compra (+) y ajuste de corrección (± según cantidad)
}

/**
 * Persiste una transacción con sus ítems y aplica el stock, todo de forma
 * atómica. Guarda snapshot de costo/precio por línea. Devuelve el id.
 */
export async function finalizarTransaccion(
  db: SQLiteDatabase,
  t: NuevaTransaccion
): Promise<string> {
  const id = newId();
  const ts = nowIso();
  // Salida categorizada (colegio/deducción): persiste como 'ajuste' pero, a
  // diferencia del ajuste de corrección, sí lleva total (el valor de la salida).
  // Solo colegio/deducción son "salidas" (restan stock con total > 0). Una
  // devolución es una venta con líneas negativas, no una salida.
  const esSalida = t.categoria === 'colegio' || t.categoria === 'deduccion';
  const esCorreccion = t.tipo === 'ajuste' && !esSalida;
  const total = esCorreccion
    ? 0
    : t.lineas.reduce(
        (acc, l) => acc + l.cantidad * l.precio_unitario_snapshot,
        0
      );

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO transacciones
         (id, tipo, fecha_hora, cliente_proveedor, motivo, categoria,
          subcategoria, total, created_at, updated_at, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      id,
      t.tipo,
      ts,
      t.cliente_proveedor ?? null,
      t.motivo ?? null,
      t.categoria ?? null,
      t.subcategoria ?? null,
      total,
      ts,
      ts
    );

    for (const l of t.lineas) {
      await db.runAsync(
        `INSERT INTO transaccion_items
           (id, transaccion_id, barcode, nombre_snapshot, cantidad,
            costo_snapshot, precio_unitario_snapshot, subtotal, synced)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        newId(),
        id,
        l.barcode,
        l.nombre,
        l.cantidad,
        l.costo_snapshot ?? null,
        l.precio_unitario_snapshot,
        l.cantidad * l.precio_unitario_snapshot
      );

      await db.runAsync(
        `UPDATE productos
           SET stock_actual = stock_actual + ?, updated_at = ?, synced = 0
         WHERE barcode = ?`,
        deltaStock(t.tipo, l.cantidad, esSalida),
        ts,
        l.barcode
      );

      // En compras, el costo de la línea pasa a ser el costo del producto, y
      // el precio de venta se actualiza al sugerido/confirmado en la UI
      // (calculado con margen y editable ahí mismo para redondear).
      if (t.tipo === 'compra' && l.costo_snapshot != null) {
        await db.runAsync(
          `UPDATE productos
             SET costo = ?, precio = ?, updated_at = ?, synced = 0
           WHERE barcode = ?`,
          l.costo_snapshot,
          l.precio_venta_snapshot ?? l.costo_snapshot,
          ts,
          l.barcode
        );
      }
    }
  });

  return id;
}

/**
 * Registra un cambio/devolución como una `venta` con categoria = 'devolucion':
 * las líneas de `devuelve` van con cantidad negativa (el producto vuelve al stock
 * y resta de las ventas) y las de `lleva` con cantidad positiva (venta normal).
 * El `total` de la transacción es el neto (lleva − devuelve). Reusa
 * `finalizarTransaccion`. Devuelve el id.
 */
export function registrarCambio(
  db: SQLiteDatabase,
  cambio: {
    devuelve: LineaBorrador[];
    lleva?: LineaBorrador[];
    cliente?: string | null;
  }
): Promise<string> {
  const lineas: LineaBorrador[] = [
    ...cambio.devuelve.map((l) => ({ ...l, cantidad: -Math.abs(l.cantidad) })),
    ...(cambio.lleva ?? []).map((l) => ({ ...l, cantidad: Math.abs(l.cantidad) })),
  ];
  return finalizarTransaccion(db, {
    tipo: 'venta',
    categoria: 'devolucion',
    cliente_proveedor: cambio.cliente?.trim() || null,
    lineas,
  });
}

export type FiltroHistorial = {
  tipo?: TipoTransaccion;
  desde?: string; // ISO
  hasta?: string; // ISO
  contraparte?: string;
  // Producto: texto (nombre) o código escaneado. Empareja transacciones que
  // tengan al menos una línea con ese producto, por barcode exacto (scan) o por
  // nombre_snapshot con LIKE tokenizado (texto, palabras en cualquier orden).
  producto?: string;
  // Tope de filas devueltas (la pantalla de anulación no necesita el historial
  // completo, solo lo bastante reciente para encontrar el movimiento).
  limite?: number;
};

export async function listarTransacciones(
  db: SQLiteDatabase,
  filtro: FiltroHistorial = {}
): Promise<Transaccion[]> {
  const where: string[] = [];
  const params: SQLiteBindValue[] = [];
  if (filtro.tipo) {
    where.push('tipo = ?');
    params.push(filtro.tipo);
  }
  if (filtro.desde) {
    where.push('fecha_hora >= ?');
    params.push(filtro.desde);
  }
  if (filtro.hasta) {
    where.push('fecha_hora <= ?');
    params.push(filtro.hasta);
  }
  if (filtro.contraparte) {
    where.push(`${sqlNormalizar('cliente_proveedor')} LIKE ?`);
    params.push(`%${normalizarBusqueda(filtro.contraparte)}%`);
  }
  if (filtro.producto && filtro.producto.trim().length > 0) {
    const term = filtro.producto.trim();
    // barcode exacto (scan) OR cada palabra del nombre presente (texto).
    const tokens = normalizarBusqueda(term).split(/\s+/).filter(Boolean);
    const nombreConds = tokens
      .map(() => `${sqlNormalizar('ti.nombre_snapshot')} LIKE ?`)
      .join(' AND ');
    where.push(
      `EXISTS (
         SELECT 1 FROM transaccion_items ti
         WHERE ti.transaccion_id = transacciones.id
           AND (ti.barcode = ? OR (${nombreConds}))
       )`
    );
    params.push(term);
    for (const t of tokens) params.push(`%${t}%`);
  }
  const sql =
    'SELECT * FROM transacciones' +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY fecha_hora DESC' +
    (filtro.limite ? ' LIMIT ?' : '');
  if (filtro.limite) params.push(filtro.limite);
  return db.getAllAsync<Transaccion>(sql, ...params);
}

export async function getTransaccion(
  db: SQLiteDatabase,
  id: string
): Promise<{ tx: Transaccion; items: TransaccionItem[] } | null> {
  const tx = await db.getFirstAsync<Transaccion>(
    'SELECT * FROM transacciones WHERE id = ?',
    id
  );
  if (!tx) return null;
  const items = await db.getAllAsync<TransaccionItem>(
    'SELECT * FROM transaccion_items WHERE transaccion_id = ?',
    id
  );
  return { tx, items };
}

export type ResumenAnulacion = {
  tipo: TipoTransaccion;
  fecha_hora: string;
  total: number;
  lineas: number;
  productos: number;
};

/**
 * Anula una operación: revierte el stock que aplicó, borra la transacción con
 * sus ítems y deja una lápida por cada documento para que el respaldo replique
 * el borrado en Firestore (ver migración v7). Todo atómico.
 *
 * OJO: en una compra, `finalizarTransaccion` pisa el costo y el precio del
 * producto y el valor anterior no se guarda en ninguna parte, así que anularla
 * NO los devuelve: hay que corregirlos a mano si hace falta. El stock sí vuelve
 * exactamente a donde estaba.
 */
export async function anularTransaccion(
  db: SQLiteDatabase,
  id: string
): Promise<ResumenAnulacion> {
  const encontrada = await getTransaccion(db, id);
  if (!encontrada) throw new Error('La operación ya no existe.');
  const { tx, items } = encontrada;

  // Un ajuste que sanó el libro es la contraparte contable de un faltante:
  // borrarlo dejaría el faltante apuntando a la nada y el stock descuadrado.
  const ligado = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM faltantes WHERE ajuste_id = ?',
    id
  );
  if ((ligado?.n ?? 0) > 0) {
    throw new Error(
      'Este ajuste corrigió un faltante registrado. Resuelve el faltante antes de anularlo.'
    );
  }

  const ts = nowIso();
  const esSalida = tx.categoria === 'colegio' || tx.categoria === 'deduccion';

  await db.withTransactionAsync(async () => {
    for (const l of items) {
      // Revertir = aplicar el delta opuesto al que puso `finalizarTransaccion`,
      // reusando la misma función para no duplicar la regla de signos.
      await db.runAsync(
        `UPDATE productos
           SET stock_actual = stock_actual - ?, updated_at = ?, synced = 0
         WHERE barcode = ?`,
        deltaStock(tx.tipo, l.cantidad, esSalida),
        ts,
        l.barcode
      );
      await db.runAsync(
        `INSERT OR REPLACE INTO eliminaciones
           (coleccion, doc_id, created_at, synced)
         VALUES ('transaccion_items', ?, ?, 0)`,
        l.id,
        ts
      );
    }

    await db.runAsync(
      'DELETE FROM transaccion_items WHERE transaccion_id = ?',
      id
    );
    await db.runAsync('DELETE FROM transacciones WHERE id = ?', id);
    await db.runAsync(
      `INSERT OR REPLACE INTO eliminaciones
         (coleccion, doc_id, created_at, synced)
       VALUES ('transacciones', ?, ?, 0)`,
      id,
      ts
    );
  });

  return {
    tipo: tx.tipo,
    fecha_hora: tx.fecha_hora,
    total: tx.total,
    lineas: items.length,
    productos: new Set(items.map((l) => l.barcode)).size,
  };
}
