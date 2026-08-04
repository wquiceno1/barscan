import type { SQLiteDatabase } from 'expo-sqlite';

export async function getConfig(
  db: SQLiteDatabase,
  clave: string
): Promise<string | null> {
  const row = await db.getFirstAsync<{ valor: string }>(
    'SELECT valor FROM configuracion WHERE clave = ?',
    clave
  );
  return row?.valor ?? null;
}

export async function setConfig(
  db: SQLiteDatabase,
  clave: string,
  valor: string
): Promise<void> {
  await db.runAsync(
    `INSERT INTO configuracion (clave, valor) VALUES (?, ?)
       ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`,
    clave,
    valor
  );
}

export async function getMargenGeneral(db: SQLiteDatabase): Promise<number> {
  const valor = await getConfig(db, 'margen_general_pct');
  const n = valor != null ? Number(valor) : NaN;
  return Number.isFinite(n) ? n : 30;
}

/** Porcentaje del salario mensual (7% por defecto). */
export async function getSalarioPct(db: SQLiteDatabase): Promise<number> {
  const valor = await getConfig(db, 'salario_pct');
  const n = valor != null ? Number(valor) : NaN;
  return Number.isFinite(n) ? n : 7;
}

/** Cantidad de productos a contar por mes en el chequeo de inventario (50 def.). */
export async function getConteoMuestra(db: SQLiteDatabase): Promise<number> {
  const valor = await getConfig(db, 'conteo_muestra');
  const n = valor != null ? Number(valor) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 50;
}

/** Devuelve y consume el siguiente correlativo para códigos internos de granel. */
export async function nextCodigoInterno(db: SQLiteDatabase): Promise<string> {
  let n = 0;
  await db.withTransactionAsync(async () => {
    const actual = await getConfig(db, 'correlativo_interno');
    n = (actual != null ? Number(actual) : 0) + 1;
    await setConfig(db, 'correlativo_interno', String(n));
  });
  return 'INT-' + String(n).padStart(6, '0');
}
