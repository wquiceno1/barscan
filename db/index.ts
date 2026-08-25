import type { SQLiteDatabase } from 'expo-sqlite';

export const DB_NAME = 'inventario.db';
const TARGET_VERSION = 7;

/**
 * Migraciones con el patrón PRAGMA user_version. Se ejecuta desde el `onInit`
 * de <SQLiteProvider>. Las migraciones futuras deben ser ADITIVAS (nuevas
 * tablas/columnas, nunca renombrar/borrar) para no romper el espejo de respaldo.
 */
export async function migrateDbIfNeeded(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

  const row = await db.getFirstAsync<{ user_version: number }>(
    'PRAGMA user_version'
  );
  let userVersion = row?.user_version ?? 0;

  if (userVersion < 1) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(DDL_V1);
      await db.runAsync(
        `INSERT OR IGNORE INTO configuracion (clave, valor) VALUES
           ('margen_general_pct', '30'),
           ('moneda', 'COP'),
           ('correlativo_interno', '0')`
      );
    });
    await db.execAsync(`PRAGMA user_version = 1`);
    userVersion = 1;
  }

  if (userVersion < 2) {
    // Salidas sin venta (colegio / deducciones): se persisten como 'ajuste'
    // distinguidas por estas dos columnas. Aditivo: no rompe el espejo de
    // respaldo (columnas nuevas, nullables).
    await db.execAsync(
      `ALTER TABLE transacciones ADD COLUMN categoria TEXT;
       ALTER TABLE transacciones ADD COLUMN subcategoria TEXT;`
    );
    await db.execAsync(`PRAGMA user_version = 2`);
    userVersion = 2;
  }

  if (userVersion < 3) {
    // Costos de transporte (fletes): gasto puro, sin productos ni stock. Tabla
    // nueva (aditivo). `foto` se reserva para la fase 2 (recibo).
    await db.execAsync(
      `CREATE TABLE IF NOT EXISTS transportes (
         id            TEXT PRIMARY KEY,
         fecha_hora    TEXT    NOT NULL,
         monto         INTEGER NOT NULL,
         transportador TEXT,
         detalle       TEXT,
         foto          TEXT,
         created_at    TEXT    NOT NULL,
         updated_at    TEXT    NOT NULL,
         synced        INTEGER NOT NULL DEFAULT 0
       );
       CREATE INDEX IF NOT EXISTS idx_transportes_fecha    ON transportes(fecha_hora);
       CREATE INDEX IF NOT EXISTS idx_transportes_unsynced ON transportes(synced) WHERE synced = 0;`
    );
    await db.execAsync(`PRAGMA user_version = 3`);
    userVersion = 3;
  }

  if (userVersion < 4) {
    // Efectivo contado por mes, para el salario del encargado. El efectivo
    // estimado (ventas − compras − transporte) se calcula al vuelo; esta tabla
    // solo guarda el conteo manual que lo sobreescribe. Aditiva (tabla nueva),
    // no rompe el espejo de respaldo.
    await db.execAsync(
      `CREATE TABLE IF NOT EXISTS caja_mensual (
         mes              TEXT PRIMARY KEY,
         efectivo_contado INTEGER,
         created_at       TEXT NOT NULL,
         updated_at       TEXT NOT NULL,
         synced           INTEGER NOT NULL DEFAULT 0
       );
       CREATE INDEX IF NOT EXISTS idx_caja_unsynced ON caja_mensual(synced) WHERE synced = 0;`
    );
    await db.execAsync(`PRAGMA user_version = 4`);
    userVersion = 4;
  }

  if (userVersion < 5) {
    // Cuadre mensual: chequeo de inventario por rotación + registro de faltantes.
    // `productos.ultimo_conteo` da la rotación (más viejo primero). `faltantes`
    // registra los descuadres con estado de resolución. `caja_mensual` gana el
    // snapshot de inventario al cierre (inventario base del mes siguiente) y una
    // base/préstamo opcional. Todo aditivo (no rompe el espejo de respaldo).
    await db.execAsync(
      `ALTER TABLE productos    ADD COLUMN ultimo_conteo     TEXT;
       ALTER TABLE caja_mensual ADD COLUMN inventario_cierre INTEGER;
       ALTER TABLE caja_mensual ADD COLUMN base_efectivo     INTEGER;

       CREATE TABLE IF NOT EXISTS faltantes (
         id              TEXT PRIMARY KEY,
         barcode         TEXT    NOT NULL,
         nombre_snapshot TEXT    NOT NULL,
         mes             TEXT    NOT NULL,
         fecha_hora      TEXT    NOT NULL,
         esperado        INTEGER NOT NULL,
         contado         INTEGER NOT NULL,
         diff_unidades   INTEGER NOT NULL,
         diff_valor      INTEGER NOT NULL,
         ajuste_id       TEXT,
         resuelto        INTEGER NOT NULL DEFAULT 0,
         resolucion_nota TEXT,
         created_at      TEXT    NOT NULL,
         updated_at      TEXT    NOT NULL,
         synced          INTEGER NOT NULL DEFAULT 0
       );
       CREATE INDEX IF NOT EXISTS idx_faltantes_mes        ON faltantes(mes);
       CREATE INDEX IF NOT EXISTS idx_faltantes_pendientes ON faltantes(resuelto) WHERE resuelto = 0;
       CREATE INDEX IF NOT EXISTS idx_faltantes_unsynced   ON faltantes(synced)   WHERE synced = 0;`
    );
    await db.runAsync(
      `INSERT OR IGNORE INTO configuracion (clave, valor) VALUES ('conteo_muestra', '50')`
    );
    await db.execAsync(`PRAGMA user_version = 5`);
    userVersion = 5;
  }

  if (userVersion < 6) {
    // Liquidación por período (trimestral, disparada a mano): cada fila es un
    // período cerrado con su snapshot (salario, inventario, faltantes…) y sirve
    // de ancla para el siguiente. El efectivo/inventario dejan de ser por mes.
    // Tabla nueva (aditiva), no rompe el espejo de respaldo.
    await db.execAsync(
      `CREATE TABLE IF NOT EXISTS liquidaciones (
         id                 TEXT PRIMARY KEY,
         fecha_hora         TEXT    NOT NULL,
         desde              TEXT,
         ventas             INTEGER NOT NULL,
         compras            INTEGER NOT NULL,
         transporte         INTEGER NOT NULL,
         colegio            INTEGER NOT NULL,
         deducciones        INTEGER NOT NULL,
         inversiones        INTEGER NOT NULL,
         efectivo           INTEGER NOT NULL,
         salario_base       INTEGER NOT NULL,
         salario_pct        REAL    NOT NULL,
         salario            INTEGER NOT NULL,
         ganancia           INTEGER NOT NULL,
         inventario_cierre  INTEGER NOT NULL,
         inventario_base    INTEGER,
         faltantes_valor    INTEGER NOT NULL,
         faltantes_cantidad INTEGER NOT NULL,
         nota               TEXT,
         created_at         TEXT    NOT NULL,
         updated_at         TEXT    NOT NULL,
         synced             INTEGER NOT NULL DEFAULT 0
       );
       CREATE INDEX IF NOT EXISTS idx_liquidaciones_fecha    ON liquidaciones(fecha_hora);
       CREATE INDEX IF NOT EXISTS idx_liquidaciones_unsynced ON liquidaciones(synced) WHERE synced = 0;`
    );
    await db.execAsync(`PRAGMA user_version = 6`);
    userVersion = 6;
  }

  if (userVersion < 7) {
    // Anulación de movimientos: al borrar una transacción localmente no queda
    // fila que subir, así que el borrado se registra como "lápida" y el push la
    // convierte en un delete en Firestore. Sin esto, borrar en el teléfono no
    // llegaría nunca a la nube (y borrar en la nube tampoco llega al teléfono,
    // porque `restaurar` es solo INSERT OR REPLACE). Las lápidas se conservan
    // aunque ya estén sincronizadas: así una reconstrucción completa del
    // respaldo vuelve a aplicar los borrados.
    await db.execAsync(
      `CREATE TABLE IF NOT EXISTS eliminaciones (
         coleccion  TEXT NOT NULL,
         doc_id     TEXT NOT NULL,
         created_at TEXT NOT NULL,
         synced     INTEGER NOT NULL DEFAULT 0,
         PRIMARY KEY (coleccion, doc_id)
       );
       CREATE INDEX IF NOT EXISTS idx_eliminaciones_unsynced ON eliminaciones(synced) WHERE synced = 0;`
    );
    await db.execAsync(`PRAGMA user_version = 7`);
    userVersion = 7;
  }

  if (userVersion !== TARGET_VERSION) {
    console.warn(
      `[db] user_version=${userVersion} difiere de TARGET_VERSION=${TARGET_VERSION}`
    );
  }
}

const DDL_V1 = `
CREATE TABLE IF NOT EXISTS productos (
  barcode        TEXT PRIMARY KEY,
  nombre         TEXT    NOT NULL,
  sin_codigo     INTEGER NOT NULL DEFAULT 0,
  categoria      TEXT,
  modo_precio    TEXT    NOT NULL DEFAULT 'margen'
                   CHECK (modo_precio IN ('margen','fijo')),
  costo          INTEGER,
  margen_pct     REAL,
  precio         INTEGER NOT NULL,
  stock_actual   INTEGER NOT NULL DEFAULT 0,
  activo         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL,
  synced         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transacciones (
  id                TEXT PRIMARY KEY,
  tipo              TEXT NOT NULL CHECK (tipo IN ('compra','venta','ajuste')),
  fecha_hora        TEXT NOT NULL,
  cliente_proveedor TEXT,
  motivo            TEXT,
  total             INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  synced            INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transaccion_items (
  id                       TEXT PRIMARY KEY,
  transaccion_id           TEXT NOT NULL
                             REFERENCES transacciones(id) ON DELETE CASCADE,
  barcode                  TEXT NOT NULL,
  nombre_snapshot          TEXT NOT NULL,
  cantidad                 INTEGER NOT NULL,
  costo_snapshot           INTEGER,
  precio_unitario_snapshot INTEGER NOT NULL,
  subtotal                 INTEGER NOT NULL,
  synced                   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS configuracion (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tx_fecha       ON transacciones(fecha_hora);
CREATE INDEX IF NOT EXISTS idx_tx_tipo_fecha  ON transacciones(tipo, fecha_hora);
CREATE INDEX IF NOT EXISTS idx_items_tx       ON transaccion_items(transaccion_id);
CREATE INDEX IF NOT EXISTS idx_items_barcode  ON transaccion_items(barcode);
CREATE INDEX IF NOT EXISTS idx_prod_nombre    ON productos(nombre);
CREATE INDEX IF NOT EXISTS idx_prod_activo    ON productos(activo);
CREATE INDEX IF NOT EXISTS idx_prod_unsynced  ON productos(synced)         WHERE synced = 0;
CREATE INDEX IF NOT EXISTS idx_tx_unsynced    ON transacciones(synced)     WHERE synced = 0;
CREATE INDEX IF NOT EXISTS idx_items_unsynced ON transaccion_items(synced) WHERE synced = 0;
`;
