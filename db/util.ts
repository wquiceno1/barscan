// Utilidades compartidas de la capa de datos.

/** Fecha-hora local en ISO 8601 sin zona: 'YYYY-MM-DDTHH:mm:ss'. */
export function nowIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** UUID v4 (suficiente para un solo dispositivo; no usa cripto fuerte). */
export function newId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Precio sugerido en COP (entero) a partir de costo y margen %. */
export function precioConMargen(costo: number, margenPct: number): number {
  return Math.round(costo * (1 + margenPct / 100));
}

/** Formato de dinero COP para mostrar (ej. 12500 -> '$12.500'). */
export function formatCOP(valor: number): string {
  return '$' + Math.round(valor).toLocaleString('es-CO');
}

/**
 * Normaliza texto para búsqueda: descompone, elimina tildes/diéresis (ñ→n) y
 * pasa a minúsculas. Robusto a la forma Unicode (NFC/NFD) porque descompone
 * antes de quitar las marcas combinantes (rango U+0300–U+036F).
 */
export function normalizarBusqueda(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Palabras de una búsqueda, normalizadas (sin acentos y en minúsculas). */
export function palabrasBusqueda(termino: string): string[] {
  return normalizarBusqueda(termino.trim()).split(/\s+/).filter(Boolean);
}

/**
 * Criterio de las búsquedas por nombre del lado de JS: cada palabra tiene que
 * aparecer en el texto, en cualquier orden y sin importar acentos. Es el mismo
 * que aplican las consultas SQL con `sqlNormalizar` + un LIKE por palabra.
 */
export function contienePalabras(texto: string, palabras: string[]): boolean {
  const t = normalizarBusqueda(texto);
  return palabras.every((p) => t.includes(p));
}

// Marcas combinantes (texto en forma NFD) y caracteres precompuestos (NFC) más
// comunes en español. Se quitan/transforman para que la comparación LIKE ignore
// los acentos sin importar cómo se haya almacenado el nombre.
const MARCAS_COMBINANTES = [0x300, 0x301, 0x302, 0x303, 0x308, 0x327];
const PRECOMPUESTOS: [string, string][] = [
  ['á', 'a'], ['é', 'e'], ['í', 'i'], ['ó', 'o'], ['ú', 'u'], ['ü', 'u'], ['ñ', 'n'],
  ['Á', 'a'], ['É', 'e'], ['Í', 'i'], ['Ó', 'o'], ['Ú', 'u'], ['Ü', 'u'], ['Ñ', 'n'],
];

/**
 * Construye una expresión SQL que normaliza `columna` igual que
 * `normalizarBusqueda`, para comparaciones LIKE insensibles a acentos.
 * `columna` es un identificador controlado por el código (nunca entrada del
 * usuario), por eso es seguro interpolarlo.
 */
export function sqlNormalizar(columna: string): string {
  let expr = columna;
  for (const cp of MARCAS_COMBINANTES) {
    expr = `replace(${expr}, char(${cp}), '')`;
  }
  for (const [de, a] of PRECOMPUESTOS) {
    expr = `replace(${expr}, '${de}', '${a}')`;
  }
  return `lower(${expr})`;
}
