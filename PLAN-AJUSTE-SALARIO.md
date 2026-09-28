# Plan: Ajuste del cálculo del salario

> **Actualización 2026-07-31 — cadencia trimestral por liquidación.** El salario ya
> **no se calcula por mes de calendario**, sino sobre el **acumulado del período de
> liquidación** (desde la última liquidación hasta hoy), que se cierra a mano ~cada
> 3 meses. La fórmula es la misma (`% × (efectivo + compras + transporte)`), pero la
> ventana es el período, y el efectivo se cuenta **una vez, al liquidar**. Ver
> [PLAN-CUADRE-MENSUAL.md](PLAN-CUADRE-MENSUAL.md) §"liquidación" y `db/liquidaciones.ts`.
> `caja_mensual` (efectivo por mes) quedó retirada; el efectivo del período vive en
> `configuracion.periodo_efectivo`.

> **Decisión 2026-09-28 — se mantiene el modelo por ventas al 7%.** Después del
> análisis patrimonial del Cierre del Período 1 se decidió conservar la fórmula
> vigente (`7% × (efectivo + compras + transporte)`, que con el efectivo estimado
> equivale a las ventas del período) para el Período 2. **No se adopta** la propuesta
> de calcular el salario sobre la riqueza generada
> ([CIERRE-PERIODO-1.md](CIERRE-PERIODO-1.md) §8). El 7% queda como porcentaje
> elegido, no solo como valor por defecto.

Estado: **implementado 2026-07-31 y en uso**: aplicado en el Cierre del Período 1
(liquidación del 12/09/2026, salario $1.499.089; ver
[CIERRE-PERIODO-1.md](CIERRE-PERIODO-1.md)). Documento de trabajo acordado con el dueño
(Tienda Comunal de la Vereda Santa Barbara), basado en la transcripción del audio
de la tesorera ([docs/info-balance-duro.md](docs/info-balance-duro.md)) y validado
contra los datos reales de julio 2026 (respaldo en Firestore).

## 1. Objetivo

Corregir el cálculo del **salario del encargado** para que se acerque al método
real que usaba la tesorera. El modelo actual **infla la base**: suma la venta
completa **y** la compra completa (más colegio y deducciones), con lo que en un mes
de reposición fuerte casi duplica el salario justo.

El método de la tesorera calculaba el sueldo como:

> **7% × (efectivo disponible + inversiones)**

donde *inversiones* = lo reinvertido en mercadería/fletes y *efectivo disponible* =
la plata contada en caja al cierre. Se hacía **trimestral**; se baja a **mensual**
(la app ya opera por mes seleccionado).

## 2. Decisiones acordadas

| Tema | Decisión |
|------|----------|
| **Inversiones** | **compras + transporte** del mes. |
| **Efectivo** | **Modelo A — flujo del mes**: `estimado = ventas − compras − transporte`, arranca de cero cada mes. Con **conteo manual** opcional que lo sobreescribe. |
| **Colegio / Deducciones** | **Salen** del cálculo del salario (son salidas de stock, no mueven efectivo). Siguen como KPIs informativos del mes. |
| **Cadencia** | **Mensual** (antes trimestral). El efectivo se resetea por mes → no re-grava el capital de trabajo. |
| **% del salario** | Se mantiene configurable en Ajustes (7% por defecto). Sin cambios. |
| **Efectivo estimado negativo** | En meses de mucha reposición puede dar negativo. Se muestra **tal cual**, sin forzar a 0 (forzarlo distorsionaría la base). |
| **PDF** | El PDF de reportes no muestra salario → **no se toca**. |

## 3. Fórmula

```
inversiones        = compras + transporte                 (del mes)
efectivo_estimado  = ventas − compras − transporte         (del mes; puede ser < 0)
efectivo_usado     = efectivo_contado ?? efectivo_estimado (override manual si existe)
base               = efectivo_usado + inversiones
salario            = round(base × salario_pct / 100)
```

**Consecuencia clave:** con el efectivo *estimado*, la base se simplifica a las
**ventas del mes** — `(ventas − compras − transp) + (compras + transp) = ventas`.
El estimado es el "techo" (asume que toda venta entró en efectivo). El **conteo
manual** de fin de mes es lo que lo corrige hacia abajo por fiados o retiros.

## 4. Modelo de datos

**Tabla nueva `caja_mensual`** — guarda **solo el conteo manual** (el estimado se
calcula al vuelo desde `transacciones`/`transportes`). Una fila por mes. Migración
**aditiva** (tabla nueva), coherente con la regla del repo.

| Columna | Tipo | Nota |
|---------|------|------|
| `mes` | TEXT PK | clave del mes, formato `'YYYY-MM'` |
| `efectivo_contado` | INTEGER | conteo real de caja (COP); **null** = usar estimado |
| `created_at` / `updated_at` | TEXT | ISO local |
| `synced` | INTEGER | 0/1 para el espejo de respaldo |

```sql
CREATE TABLE IF NOT EXISTS caja_mensual (
  mes              TEXT PRIMARY KEY,        -- 'YYYY-MM'
  efectivo_contado INTEGER,                 -- null = usar estimado
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  synced           INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_caja_unsynced ON caja_mensual(synced) WHERE synced = 0;
```

## 5. Migración y respaldo

1. **`db/index.ts`** — subir `TARGET_VERSION` a **4** y agregar bloque
   `if (userVersion < 4)` con el `CREATE TABLE`/índice de arriba
   (`PRAGMA user_version = 4`).
2. **`lib/backup.ts`** — agregar `'caja_mensual'` a `TABLAS_SYNC` (esto ya cubre
   `contarPendientes`, `estadoRespaldo`, `marcarTodoPendienteRespaldo` y
   `vaciarRespaldoRemoto`, que iteran ese arreglo) y sumarla a:
   - **Subida** (`respaldarImpl`): leer `SELECT * FROM caja_mensual WHERE synced = 0`,
     empujar a la colección `caja_mensual` con `id = mes`, y agregar la llamada a
     `marcarSincronizado(db, 'caja_mensual', 'mes', …)`.
   - **Restore** (`restaurarImpl`): `getDocs('caja_mensual')` +
     `INSERT OR REPLACE INTO caja_mensual (…) VALUES (…, 1)`.

> Motivo de tabla nueva (no `configuracion`): `configuracion` es clave/valor y se
> llenaría de `efectivo_2026-07`, `…-08`… Además es plata: una tabla con `synced`
> propio dispara su respaldo aunque el mes no tenga otros cambios.

## 6. Capa de datos — `db/caja.ts` (nuevo)

```ts
export type CajaMensual = {
  mes: string;                    // 'YYYY-MM'
  efectivo_contado: number | null;
  created_at: string;
  updated_at: string;
  synced: number;
};

// Conteo manual guardado para un mes (null si no hay → se usa el estimado).
getEfectivoContado(db, mes: string): Promise<number | null>;

// Guarda/actualiza el conteo (o null para "volver al estimado").
// Upsert: marca updated_at = ahora y synced = 0.
setEfectivoContado(db, mes: string, monto: number | null): Promise<void>;
```

## 7. Interfaz — `app/(tabs)/reportes.tsx`

Todo el cambio de UI está en la vista **"Ventas por mes"** y su tarjeta de salario.

- **Cálculo** (reemplaza [reportes.tsx:96-101](<app/(tabs)/reportes.tsx#L96-L101>)):
  usar la fórmula de la sección 3. `colegio` y `deducciones` **ya no entran**.
- **Carga del conteo**: nuevo `useFocusEffect` que llama `getEfectivoContado(db, mesKey)`
  al cambiar de mes / volver a la pantalla. `mesKey` (`'YYYY-MM'`) se deriva con la
  misma lógica de `rangoMes`.
- **Desglose de la tarjeta** (reemplaza las 5 filas actuales por):

  | Fila | Valor |
  |------|-------|
  | Efectivo (estimado / **conteo**) | `efectivo_usado` |
  | Inversiones (compras + transporte) | `inversiones` |
  | *(divisor)* | |
  | Base | `base` (negrita) |
  | Salario (`pct`%) | `salario` (negrita, color primario) |

  La etiqueta del efectivo indica si es *estimado* o *conteo* según haya override.
- **Editar el conteo**: dentro del cuerpo expandido, un `Input` numérico
  ("Efectivo contado — opcional") que guarda con `setEfectivoContado` al confirmar,
  y un enlace **"Usar estimado"** que lo limpia (`monto = null`). Reusar el
  componente `Input` de `components/ui`.
- Los KPIs de **Colegio** y **Deducciones** del mes se mantienen (informativos).

## 8. Textos a actualizar

- **`app/(tabs)/ajustes.tsx`** — la ayuda dice "…salario mensual sobre ventas,
  compras, transporte y deducciones". Cambiar a algo como: "…% de tu salario
  mensual sobre el efectivo (estimado o contado) más lo invertido en compras y
  transporte."
- **`README.md`** — bullet de "Salario del encargado" (hoy "…porcentaje
  configurable sobre el movimiento del mes"): reflejar el nuevo modelo
  (efectivo + inversiones, con conteo manual ajustable).

## 9. Validación con datos reales — Julio 2026

Datos reales del respaldo (1.073 ventas, 210 compras, 4 fletes):

| Insumo | Valor |
|--------|-------|
| Ventas | $7.629.300 |
| Compras | $6.127.521 |
| Transporte | $199.000 |
| Colegio | $53.500 |
| Deducciones | $73.900 |

| Modelo | Base | Salario (7%) |
|--------|------|--------------|
| **Actual** (ventas+compras+transp+colegio+deducc) | $14.083.221 | **$985.825** |
| **Nuevo A** (efectivo estimado + inversiones = ventas) | $7.629.300 | **$534.051** |

Julio fue mes de reposición fuerte (compras ≈ 80% de ventas), justo donde el modelo
viejo más se dispara. El nuevo da el **54%** del actual (−$451.774). Con el efectivo
estimado, el salario de julio queda en **$534.051**; un conteo real de caja lo
ajustaría con `7% × (efectivo_contado + $6.326.521)`.

## 10. Alcance y notas

- **Fase única (esta):** migración v4 + tabla, `db/caja.ts`, respaldo
  (subida/restore), fórmula + desglose + entrada de conteo en Reportes, textos.
- **Fuera de alcance:** el **cuadre completo** de la tesorera (fiados, arrastre,
  inventario base del período anterior, ganancia de inversión). Eso es un módulo
  aparte; este plan solo corrige el **salario**.
- **Borrado/tombstones:** igual que el resto del modelo, el respaldo es espejo de
  una vía sin tombstones. Limpiar un conteo se hace con `efectivo_contado = null`
  (la fila sigue existiendo y se respalda), no borrando la fila.
- **Checklist de archivos:** `db/index.ts`, `db/caja.ts` (nuevo), `lib/backup.ts`,
  `db/types.ts` (opcional, si se centraliza el tipo), `app/(tabs)/reportes.tsx`,
  `app/(tabs)/ajustes.tsx`, `README.md`.
