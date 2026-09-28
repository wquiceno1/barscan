// Motor de respaldo: espejo de una vía local -> Firestore, con restauración
// solo cuando la base local está vacía (recuperación ante pérdida de hardware).
//
// El esquema SQLite ya está preparado: cada fila tiene `synced` (0 pendiente,
// 1 respaldada) e índices parciales sobre synced = 0. El push lee solo lo
// pendiente y lo marca como sincronizado; el restore reescribe lo local con
// synced = 1. La configuración (tabla sin `synced`) se respalda completa por
// ser pequeña.
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  collection,
  doc,
  getDocs,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore';
import type { Producto, Transaccion, TransaccionItem } from '../db/types';
import type { Transporte } from '../db/transportes';
import type { CajaMensual } from '../db/caja';
import type { Faltante } from '../db/faltantes';
import type { Liquidacion } from '../db/liquidaciones';
import { getConfig, setConfig } from '../db/configuracion';
import { usuarioActual } from './auth';
import { db as firestore } from './firebase';

// writeBatch admite hasta 500 operaciones; dejamos margen.
const LIMITE_LOTE = 400;

const TABLAS_SYNC = [
  'productos',
  'transacciones',
  'transaccion_items',
  'transportes',
  'caja_mensual',
  'faltantes',
  'liquidaciones',
] as const;

// Lápidas de filas borradas localmente (ver migración v7). No es una colección
// espejo —nunca se sube como documento—, por eso va fuera de TABLAS_SYNC: el
// push la traduce a un `delete` en Firestore.
const TABLA_ELIMINACIONES = 'eliminaciones';

/** Avance de una operación larga de respaldo. */
export type ProgresoRespaldo = {
  /** Qué se está haciendo ahora, para mostrar sobre la barra. */
  fase: string;
  /**
   * Avance global de la operación, de 0 a 1. Es una escala única para toda la
   * operación aunque tenga varias etapas: la barra nunca retrocede.
   */
  valor: number;
  /** Conteo de la etapa en curso ("1200 de 9100"), o null si no aplica. */
  detalle: string | null;
};

export type OnProgreso = (p: ProgresoRespaldo) => void;

export type EstadoRespaldo = {
  ultimoRespaldo: string | null;
  pendientes: number;
};

// expo-sqlite no admite transacciones concurrentes sobre la misma conexión.
// SyncManager y RecuperarGate pueden disparar respaldo/restauración a la vez
// (p. ej. al iniciar sesión), así que serializamos ambas en una sola cola.
let cola: Promise<unknown> = Promise.resolve();
function enSerie<T>(tarea: () => Promise<T>): Promise<T> {
  const resultado = cola.then(tarea, tarea);
  cola = resultado.then(
    () => undefined,
    () => undefined
  );
  return resultado;
}

export async function contarPendientes(db: SQLiteDatabase): Promise<number> {
  let total = 0;
  for (const t of TABLAS_SYNC) {
    const row = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${t} WHERE synced = 0`
    );
    total += row?.n ?? 0;
  }
  const borradas = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${TABLA_ELIMINACIONES} WHERE synced = 0`
  );
  total += borradas?.n ?? 0;
  return total;
}

export async function estadoRespaldo(
  db: SQLiteDatabase
): Promise<EstadoRespaldo> {
  return {
    ultimoRespaldo: await getConfig(db, 'last_backup_at'),
    pendientes: await contarPendientes(db),
  };
}

/**
 * Fuerza un re-respaldo completo: vuelve a marcar productos, transacciones e
 * items como pendientes para reconstruir Firestore desde la copia local.
 */
export function marcarTodoPendienteRespaldo(
  db: SQLiteDatabase
): Promise<number> {
  return enSerie(async () => {
    await db.withTransactionAsync(async () => {
      for (const tabla of TABLAS_SYNC) {
        await db.execAsync(`UPDATE ${tabla} SET synced = 0`);
      }
      // Las anulaciones también se reaplican: si no, reconstruir el respaldo
      // dejaría en la nube documentos que ya se borraron en el teléfono.
      await db.execAsync(`UPDATE ${TABLA_ELIMINACIONES} SET synced = 0`);
    });
    return contarPendientes(db);
  });
}

async function borrarColeccion(nombre: string): Promise<number> {
  let borrados = 0;
  const snap = await getDocs(collection(firestore, nombre));
  const docs = snap.docs;

  for (let i = 0; i < docs.length; i += LIMITE_LOTE) {
    const lote = writeBatch(firestore);
    for (const d of docs.slice(i, i + LIMITE_LOTE)) {
      lote.delete(d.ref);
      borrados++;
    }
    await lote.commit();
  }

  return borrados;
}

/**
 * Borra por completo el respaldo remoto guardado en Firestore.
 * OJO: en el esquema actual esto elimina todas las colecciones espejo del
 * proyecto Firebase, por lo que debe usarse solo en entornos de un unico
 * negocio/usuario.
 */
export function vaciarRespaldoRemoto(): Promise<number> {
  return enSerie(async () => {
    if (!usuarioActual()) throw new Error('Sesión no iniciada');

    let borrados = 0;
    for (const nombre of [...TABLAS_SYNC, 'configuracion']) {
      borrados += await borrarColeccion(nombre);
    }
    return borrados;
  });
}

/** La base local no tiene datos de negocio (teléfono nuevo / reinstalación). */
export async function baseVacia(db: SQLiteDatabase): Promise<boolean> {
  const p = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM productos'
  );
  const t = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM transacciones'
  );
  return (p?.n ?? 0) === 0 && (t?.n ?? 0) === 0;
}

async function marcarSincronizado(
  db: SQLiteDatabase,
  tabla: string,
  idCol: string,
  ids: string[]
): Promise<void> {
  const CHUNK = 400; // SQLite limita la cantidad de parámetros (~999)
  for (let i = 0; i < ids.length; i += CHUNK) {
    const grupo = ids.slice(i, i + CHUNK);
    const placeholders = grupo.map(() => '?').join(',');
    await db.runAsync(
      `UPDATE ${tabla} SET synced = 1 WHERE ${idCol} IN (${placeholders})`,
      ...grupo
    );
  }
}

/**
 * Sube a Firestore todo lo pendiente y lo marca como sincronizado.
 * Devuelve la cantidad de filas respaldadas. Requiere sesión iniciada.
 */
export function respaldar(
  db: SQLiteDatabase,
  onProgreso?: OnProgreso
): Promise<number> {
  return enSerie(() => respaldarImpl(db, onProgreso));
}

async function respaldarImpl(
  db: SQLiteDatabase,
  onProgreso?: OnProgreso
): Promise<number> {
  if (!usuarioActual()) throw new Error('Sesión no iniciada');

  const productos = await db.getAllAsync<Producto>(
    'SELECT * FROM productos WHERE synced = 0'
  );
  const transacciones = await db.getAllAsync<Transaccion>(
    'SELECT * FROM transacciones WHERE synced = 0'
  );
  const items = await db.getAllAsync<TransaccionItem>(
    'SELECT * FROM transaccion_items WHERE synced = 0'
  );
  const transportes = await db.getAllAsync<Transporte>(
    'SELECT * FROM transportes WHERE synced = 0'
  );
  const caja = await db.getAllAsync<CajaMensual>(
    'SELECT * FROM caja_mensual WHERE synced = 0'
  );
  const faltantes = await db.getAllAsync<Faltante>(
    'SELECT * FROM faltantes WHERE synced = 0'
  );
  const liquidaciones = await db.getAllAsync<Liquidacion>(
    'SELECT * FROM liquidaciones WHERE synced = 0'
  );

  const ops: { col: string; id: string; data: DocumentData }[] = [
    ...productos.map((p) => ({ col: 'productos', id: p.barcode, data: p })),
    ...transacciones.map((t) => ({ col: 'transacciones', id: t.id, data: t })),
    ...items.map((i) => ({ col: 'transaccion_items', id: i.id, data: i })),
    ...transportes.map((tr) => ({ col: 'transportes', id: tr.id, data: tr })),
    ...caja.map((c) => ({ col: 'caja_mensual', id: c.mes, data: c })),
    ...faltantes.map((f) => ({ col: 'faltantes', id: f.id, data: f })),
    ...liquidaciones.map((l) => ({ col: 'liquidaciones', id: l.id, data: l })),
  ];

  // Configuración completa (pequeña): se respalda siempre. Se lee acá, junto
  // con las lápidas, para poder anunciar el total antes de empezar a subir.
  const config = await db.getAllAsync<{ clave: string; valor: string }>(
    'SELECT * FROM configuracion'
  );
  const eliminadas = await db.getAllAsync<{
    coleccion: string;
    doc_id: string;
  }>(`SELECT coleccion, doc_id FROM ${TABLA_ELIMINACIONES} WHERE synced = 0`);

  // El avance se informa por lote (no por fila): son los commits los que
  // tardan, y así la UI se repinta unas pocas veces en vez de miles.
  const total = ops.length + config.length + eliminadas.length;
  let hechos = 0;
  const avisar = (fase: string) =>
    onProgreso?.({
      fase,
      valor: total > 0 ? hechos / total : 1,
      detalle: total > 0 ? `${hechos} de ${total}` : null,
    });
  avisar('Subiendo cambios');

  for (let i = 0; i < ops.length; i += LIMITE_LOTE) {
    const lote = writeBatch(firestore);
    const tanda = ops.slice(i, i + LIMITE_LOTE);
    for (const op of tanda) {
      lote.set(doc(firestore, op.col, op.id), op.data);
    }
    await lote.commit();
    hechos += tanda.length;
    avisar('Subiendo cambios');
  }

  if (config.length) {
    const lote = writeBatch(firestore);
    for (const c of config) {
      lote.set(doc(firestore, 'configuracion', c.clave), c);
    }
    await lote.commit();
    hechos += config.length;
    avisar('Subiendo configuración');
  }

  // Anulaciones: cada lápida se traduce en un delete del documento espejo. Va
  // después de las escrituras para que, si algo se anuló durante esta misma
  // tanda, el borrado quede al final y no lo pise un `set` posterior.
  for (let i = 0; i < eliminadas.length; i += LIMITE_LOTE) {
    const lote = writeBatch(firestore);
    const tanda = eliminadas.slice(i, i + LIMITE_LOTE);
    for (const e of tanda) {
      lote.delete(doc(firestore, e.coleccion, e.doc_id));
    }
    await lote.commit();
    hechos += tanda.length;
    avisar('Aplicando anulaciones');
  }

  // Marcar como sincronizado solo lo que efectivamente subimos (por id),
  // para no perder cambios hechos durante la subida.
  await db.withTransactionAsync(async () => {
    await marcarSincronizado(
      db,
      'productos',
      'barcode',
      productos.map((p) => p.barcode)
    );
    await marcarSincronizado(
      db,
      'transacciones',
      'id',
      transacciones.map((t) => t.id)
    );
    await marcarSincronizado(
      db,
      'transaccion_items',
      'id',
      items.map((i) => i.id)
    );
    await marcarSincronizado(
      db,
      'transportes',
      'id',
      transportes.map((tr) => tr.id)
    );
    await marcarSincronizado(
      db,
      'caja_mensual',
      'mes',
      caja.map((c) => c.mes)
    );
    await marcarSincronizado(
      db,
      'faltantes',
      'id',
      faltantes.map((f) => f.id)
    );
    await marcarSincronizado(
      db,
      'liquidaciones',
      'id',
      liquidaciones.map((l) => l.id)
    );
    await marcarSincronizado(
      db,
      TABLA_ELIMINACIONES,
      'doc_id',
      eliminadas.map((e) => e.doc_id)
    );
  });

  await setConfig(db, 'last_backup_at', new Date().toISOString());
  avisar('Listo');
  return ops.length + eliminadas.length;
}

/**
 * Descarga el espejo de Firestore a la base local. Pensado para una base
 * vacía (teléfono nuevo). Reescribe filas con synced = 1. Devuelve el total
 * de filas restauradas. Requiere sesión iniciada.
 */
export function restaurar(
  db: SQLiteDatabase,
  onProgreso?: OnProgreso
): Promise<number> {
  return enSerie(() => restaurarImpl(db, onProgreso));
}

async function restaurarImpl(
  db: SQLiteDatabase,
  onProgreso?: OnProgreso
): Promise<number> {
  if (!usuarioActual()) throw new Error('Sesión no iniciada');

  // La restauración tiene dos etapas de costo muy distinto. Se reportan sobre
  // una escala única para que la barra no llegue al 100 % y vuelva a empezar:
  // la descarga ocupa el primer tramo y la escritura el resto.
  const PESO_DESCARGA = 0.2;
  const COLECCIONES = 8;
  let bajadas = 0;
  const avisarDescarga = () =>
    onProgreso?.({
      fase: 'Descargando respaldo',
      valor: (bajadas / COLECCIONES) * PESO_DESCARGA,
      detalle: `${bajadas} de ${COLECCIONES} colecciones`,
    });

  // Bajan en paralelo, pero cada una avisa al resolverse, así la barra avanza
  // durante la espera de red.
  const bajar = (nombre: string) =>
    getDocs(collection(firestore, nombre)).then((snap) => {
      bajadas++;
      avisarDescarga();
      return snap;
    });

  avisarDescarga();
  const [
    productos,
    transacciones,
    items,
    transportes,
    caja,
    faltantes,
    liquidaciones,
    config,
  ] = await Promise.all([
      bajar('productos'),
      bajar('transacciones'),
      bajar('transaccion_items'),
      bajar('transportes'),
      bajar('caja_mensual'),
      bajar('faltantes'),
      bajar('liquidaciones'),
      bajar('configuracion'),
    ]);

  // Lo anulado en el teléfono no vuelve por la puerta de atrás: mientras la
  // lápida no se haya subido, el documento sigue vivo en la nube y sin este
  // filtro la restauración lo reviviría.
  const lapidas = await db.getAllAsync<{ coleccion: string; doc_id: string }>(
    `SELECT coleccion, doc_id FROM ${TABLA_ELIMINACIONES}`
  );
  const anulado = new Set(lapidas.map((e) => `${e.coleccion}/${e.doc_id}`));

  // Escritura: acá sí hay miles de filas, así que se avisa cada 50 para no
  // ahogar el hilo de JS en re-renders.
  const filas =
    productos.docs.length +
    transacciones.docs.length +
    items.docs.length +
    transportes.docs.length +
    caja.docs.length +
    faltantes.docs.length +
    liquidaciones.docs.length +
    config.docs.length;
  let escritas = 0;
  const avisarEscritura = () =>
    onProgreso?.({
      fase: 'Guardando en el teléfono',
      valor:
        PESO_DESCARGA +
        (filas > 0 ? escritas / filas : 1) * (1 - PESO_DESCARGA),
      detalle: `${escritas} de ${filas} registros`,
    });
  const avanzar = () => {
    escritas++;
    if (escritas % 50 === 0) avisarEscritura();
  };
  avisarEscritura();

  let total = 0;
  await db.withTransactionAsync(async () => {
    for (const d of productos.docs) {
      const p = d.data() as Producto;
      await db.runAsync(
        `INSERT OR REPLACE INTO productos
           (barcode, nombre, sin_codigo, categoria, modo_precio, costo,
            margen_pct, precio, stock_actual, activo, ultimo_conteo,
            created_at, updated_at, synced)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        p.barcode,
        p.nombre,
        p.sin_codigo,
        p.categoria ?? null,
        p.modo_precio,
        p.costo ?? null,
        p.margen_pct ?? null,
        p.precio,
        p.stock_actual,
        p.activo,
        p.ultimo_conteo ?? null,
        p.created_at,
        p.updated_at
      );
      total++;
      avanzar();
    }

    for (const d of transacciones.docs) {
      if (anulado.has(`transacciones/${d.id}`)) continue;
      const t = d.data() as Transaccion;
      await db.runAsync(
        `INSERT OR REPLACE INTO transacciones
           (id, tipo, fecha_hora, cliente_proveedor, motivo, categoria,
            subcategoria, total, created_at, updated_at, synced)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        t.id,
        t.tipo,
        t.fecha_hora,
        t.cliente_proveedor ?? null,
        t.motivo ?? null,
        t.categoria ?? null,
        t.subcategoria ?? null,
        t.total,
        t.created_at,
        t.updated_at
      );
      total++;
      avanzar();
    }

    for (const d of items.docs) {
      if (anulado.has(`transaccion_items/${d.id}`)) continue;
      const it = d.data() as TransaccionItem;
      await db.runAsync(
        `INSERT OR REPLACE INTO transaccion_items
           (id, transaccion_id, barcode, nombre_snapshot, cantidad,
            costo_snapshot, precio_unitario_snapshot, subtotal, synced)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        it.id,
        it.transaccion_id,
        it.barcode,
        it.nombre_snapshot,
        it.cantidad,
        it.costo_snapshot ?? null,
        it.precio_unitario_snapshot,
        it.subtotal
      );
      total++;
      avanzar();
    }

    for (const d of transportes.docs) {
      if (anulado.has(`transportes/${d.id}`)) continue;
      const tr = d.data() as Transporte;
      await db.runAsync(
        `INSERT OR REPLACE INTO transportes
           (id, fecha_hora, monto, transportador, detalle, foto,
            created_at, updated_at, synced)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        tr.id,
        tr.fecha_hora,
        tr.monto,
        tr.transportador ?? null,
        tr.detalle ?? null,
        tr.foto ?? null,
        tr.created_at,
        tr.updated_at
      );
      total++;
      avanzar();
    }

    for (const d of caja.docs) {
      const c = d.data() as CajaMensual;
      await db.runAsync(
        `INSERT OR REPLACE INTO caja_mensual
           (mes, efectivo_contado, inventario_cierre, base_efectivo,
            created_at, updated_at, synced)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        c.mes,
        c.efectivo_contado ?? null,
        c.inventario_cierre ?? null,
        c.base_efectivo ?? null,
        c.created_at,
        c.updated_at
      );
      total++;
      avanzar();
    }

    for (const d of faltantes.docs) {
      const f = d.data() as Faltante;
      await db.runAsync(
        `INSERT OR REPLACE INTO faltantes
           (id, barcode, nombre_snapshot, mes, fecha_hora, esperado, contado,
            diff_unidades, diff_valor, ajuste_id, resuelto, resolucion_nota,
            created_at, updated_at, synced)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        f.id,
        f.barcode,
        f.nombre_snapshot,
        f.mes,
        f.fecha_hora,
        f.esperado,
        f.contado,
        f.diff_unidades,
        f.diff_valor,
        f.ajuste_id ?? null,
        f.resuelto,
        f.resolucion_nota ?? null,
        f.created_at,
        f.updated_at
      );
      total++;
      avanzar();
    }

    for (const d of liquidaciones.docs) {
      const l = d.data() as Liquidacion;
      await db.runAsync(
        `INSERT OR REPLACE INTO liquidaciones
           (id, fecha_hora, desde, ventas, compras, transporte, colegio,
            deducciones, inversiones, efectivo, salario_base, salario_pct,
            salario, ganancia, inventario_cierre, inventario_base,
            faltantes_valor, faltantes_cantidad, nota, created_at, updated_at,
            synced)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        l.id,
        l.fecha_hora,
        l.desde ?? null,
        l.ventas,
        l.compras,
        l.transporte,
        l.colegio,
        l.deducciones,
        l.inversiones,
        l.efectivo,
        l.salario_base,
        l.salario_pct,
        l.salario,
        l.ganancia,
        l.inventario_cierre,
        l.inventario_base ?? null,
        l.faltantes_valor,
        l.faltantes_cantidad,
        l.nota ?? null,
        l.created_at,
        l.updated_at
      );
      total++;
      avanzar();
    }

    for (const d of config.docs) {
      const c = d.data() as { clave: string; valor: string };
      await db.runAsync(
        'INSERT OR REPLACE INTO configuracion (clave, valor) VALUES (?, ?)',
        c.clave,
        c.valor
      );
    }
  });

  // Cierre explícito: las filas anuladas se saltan, así que el contador no
  // llega solo al total.
  onProgreso?.({ fase: 'Listo', valor: 1, detalle: null });
  return total;
}
