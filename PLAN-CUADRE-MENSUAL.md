# Plan: Cuadre mensual → trimestral por liquidación

> **Actualización 2026-07-31 — cadencia trimestral por liquidación.** Se abandonó el
> "mes de calendario": el cuadre y el salario operan sobre el **período de
> liquidación** (desde la última liquidación hasta hoy), que se cierra **a mano**
> (~cada 3 meses, con recordatorio al pasar 3). Implementado en `db/liquidaciones.ts`
> (migración **v6**, tabla `liquidaciones`) + botón **"Liquidar período"** en Reportes,
> que snapshotea salario, inventario, ganancia y faltantes y ancla el período
> siguiente. El chequeo por rotación y `faltantes` no cambian (se agregan por rango).
> El "Cerrar mes" y el efectivo/inventario por mes quedaron retirados.

Estado: **implementado 2026-07-31 (fase 1 + trimestral)**. La liquidación trimestral
ya está en uso: el Período 1 se liquidó el 12/09/2026
([CIERRE-PERIODO-1.md](CIERRE-PERIODO-1.md)). Falta confirmar en el dispositivo el
chequeo por rotación y el registro de faltantes. Documento de trabajo acordado con el dueño
(Tienda Comunal de la Vereda Santa Barbara), basado en el cuadre trimestral que
hacía la tesorera ([docs/info-balance-duro.md](docs/info-balance-duro.md)),
bajado a **mensual** y adaptado para ser lo más automático posible con nuestra data.

Depende del plan de salario ([PLAN-AJUSTE-SALARIO.md](PLAN-AJUSTE-SALARIO.md)):
comparte la tabla mensual y el concepto de efectivo/sueldo.

## 1. Objetivo

Reproducir el **cuadre** de la tesorera (cruzar "lo que hay" contra "lo esperado"
para detectar sobrantes/faltantes) sin forzar un conteo total de la tienda cada
mes. Con las decisiones tomadas, se materializa en **dos herramientas prácticas**
dentro de Reportes:

- **A. Resumen financiero del mes** (automático, lado "libro").
- **B. Chequeo de inventario por rotación** (el señal físico) → sana el libro y
  alimenta un **registro de faltantes** para revisar responsabilidad después.

## 2. Concepto: físico vs. libro

Un cuadre es una **reconciliación físico contra libro**; su valor es detectar la
diferencia (merma/robo/errores). Si ambos lados salieran de nuestra data interna,
la diferencia colapsaría a ≈0 por construcción. Por eso el faltante **solo** surge
de los **conteos físicos**. Como no haremos conteo total, el faltante se detecta por
**muestreo rotativo**: no da un faltante total exacto, sino una **señal de deriva +
corrección puntual** que, con rotación, termina cubriendo todo el catálogo.

## 3. Decisiones acordadas

| Tema | Decisión |
|------|----------|
| **Fiados** | **Descartados** del todo. No se registran en ningún momento. |
| **Arrastre** | = **transporte / fletes** (tabla `transportes` ya existente). Automático, sin mecanismo nuevo. Ver [nota de dominio]. |
| **Conteo físico** | **No** conteo total. **Chequeo por rotación**: el sistema elige N productos (los menos recientemente contados), se cuentan y confirman. |
| **Tamaño de muestra** | **Configurable** (default **50/mes**). Con 497 productos con stock, cubre todo en ~10 meses. |
| **Selección** | **Rotación**: `ultimo_conteo` más viejo primero (nunca contados primero). |
| **Descuadre** | **Sana el libro** (ajuste de corrección) **y** registra el faltante en tabla dedicada, con estado de resolución (quién paga / cómo se maneja). |
| **Valuación** | **A precio de venta** (solo 29% de productos tiene costo; precio es el único dato completo, y así ya se valorizan colegio/deducciones). |
| **Inventario base** | Snapshot del valor de inventario al cierre de cada mes, para anclar el mes siguiente. |

## 4. Módulo A — Resumen financiero del mes (automático)

Todo desde la data existente + el snapshot. Nada nuevo que digitar salvo el efectivo
contado (del plan de salario) y, opcional, base/préstamo.

| Línea | Fuente | Estado |
|-------|--------|--------|
| Valor de inventario (a precio) | `valorInventario().alPrecio` | ✅ |
| **Inventario base** (cierre mes anterior) | `caja_mensual.inventario_cierre` del mes −1 | ❌ nuevo (snapshot) |
| Ganancia del mes | `utilidadPeriodo()` (con cobertura %) | ✅ (caveat 29% costos) |
| Ventas / Compras | `totalPorTipo()` | ✅ |
| Arrastre (transporte) | `totalTransporte()` | ✅ |
| Deducciones / Colegio | `deducciones()` / `salidasColegio()` | ✅ |
| Efectivo / Salario | plan de salario (`caja_mensual`) | 🟡 |

Al **cerrar el mes** se guarda `inventario_cierre = valorInventario().alPrecio` en la
fila del mes. El "inventario base" de un mes = el `inventario_cierre` del mes
anterior. El primer mes sin snapshot previo se ingresa a mano (o queda en blanco).

## 5. Módulo B — Chequeo de inventario por rotación

### 5.1 Selección (rotación)

```sql
SELECT * FROM productos
 WHERE activo = 1 AND stock_actual > 0
 ORDER BY ultimo_conteo ASC   -- SQLite pone NULL (nunca contados) primero
 LIMIT :muestra;              -- configuracion.conteo_muestra (default 50)
```

Al contar un producto (cuadre o no) se marca `ultimo_conteo = ahora`, así rota hacia
el fondo de la cola. Progreso del ciclo = cuántos con `ultimo_conteo` reciente.

### 5.2 Flujo de conteo

Por cada producto de la muestra: mostrar el nombre, **pedir la cantidad contada**
(sin mostrar el esperado de entrada, para no sesgar), confirmar. Luego:

- **Cuadra** (`contado == esperado`): marcar `ultimo_conteo`, sin más.
- **Descuadra** (`contado != esperado`): además de marcar `ultimo_conteo`:
  1. **Sanar el libro** → `finalizarTransaccion(db, { tipo: 'ajuste', motivo: 'Chequeo de inventario YYYY-MM', lineas: [{ …, cantidad: contado - esperado }] })`.
     La `cantidad` va **con signo** (faltante < 0, sobrante > 0); como es ajuste de
     corrección (`categoria = null`) el `total` es 0 → **no contamina los reportes de
     dinero**, solo corrige el stock y queda trazable en el Historial.
  2. **Registrar el faltante** → fila en `faltantes` con el valor y estado de
     resolución (ver 6.2), enlazada al `ajuste_id` que la sanó.

### 5.3 Resultado del mes

"Contados este ciclo: 342/497 · Descuadres del mes: 4 · Valor: −$38.000" y enlace al
**panel de faltantes** pendientes.

## 6. Modelo de datos

### 6.1 Columna nueva en `productos` — rotación

```sql
ALTER TABLE productos ADD COLUMN ultimo_conteo TEXT;   -- ISO local; null = nunca
```

### 6.2 Tabla nueva `faltantes` — registro con resolución

```sql
CREATE TABLE IF NOT EXISTS faltantes (
  id              TEXT PRIMARY KEY,
  barcode         TEXT    NOT NULL,
  nombre_snapshot TEXT    NOT NULL,
  mes             TEXT    NOT NULL,   -- 'YYYY-MM'
  fecha_hora      TEXT    NOT NULL,
  esperado        INTEGER NOT NULL,   -- stock de libro al contar
  contado         INTEGER NOT NULL,
  diff_unidades   INTEGER NOT NULL,   -- contado - esperado (negativo = faltante)
  diff_valor      INTEGER NOT NULL,   -- diff_unidades * precio (a precio de venta)
  ajuste_id       TEXT,               -- transaccion 'ajuste' que sanó el libro
  resuelto        INTEGER NOT NULL DEFAULT 0,
  resolucion_nota TEXT,
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL,
  synced          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_faltantes_mes        ON faltantes(mes);
CREATE INDEX IF NOT EXISTS idx_faltantes_pendientes ON faltantes(resuelto) WHERE resuelto = 0;
CREATE INDEX IF NOT EXISTS idx_faltantes_unsynced   ON faltantes(synced)   WHERE synced = 0;
```

Solo los **descuadres** generan fila. Los conteos correctos solo actualizan
`ultimo_conteo`. El `diff_valor` se calcula **a precio de venta** — decisión firme:
es lo que hacía la tesorera (todo su cuadre era en precio), es el único dato completo
(solo 29% tiene costo; nunca tratar costo null como 0) y es como el código ya
valoriza las salidas. Cobrar el faltante a precio incluye el margen; migrar a costo
es una **mejora futura** viable cuando la cobertura de costos suba (cada compra
rellena el costo del producto), pero no bloquea la v1.

### 6.3 Columnas nuevas en la tabla mensual (`caja_mensual` del plan de salario)

```sql
ALTER TABLE caja_mensual ADD COLUMN inventario_cierre INTEGER;  -- snapshot a precio
ALTER TABLE caja_mensual ADD COLUMN base_efectivo      INTEGER;  -- préstamo/base (raro)
```

> Si el plan de salario aún no creó `caja_mensual`, se crea completa (con estas
> columnas) en esta misma migración.

### 6.4 Config

`configuracion.conteo_muestra` (default `'50'`), editable en Ajustes.

## 7. Migración y respaldo

1. **`db/index.ts`** — subir `TARGET_VERSION` a **5** (asume que el plan de salario
   introdujo v4; si se implementan juntas, coordinar el número) y bloque
   `if (userVersion < 5)` con: `ALTER productos ADD ultimo_conteo`, `CREATE TABLE
   faltantes` + índices, `ALTER caja_mensual ADD inventario_cierre/base_efectivo`,
   e `INSERT OR IGNORE` de `conteo_muestra`.
2. **`lib/backup.ts`**:
   - Agregar `'faltantes'` a `TABLAS_SYNC` + subida (`SELECT * … synced = 0`,
     `id`) + restore (`INSERT OR REPLACE`).
   - `productos`: agregar `ultimo_conteo` a la lista explícita de columnas del
     `INSERT OR REPLACE` en `restaurarImpl` (la subida usa `SELECT *`, ya lo cubre).
   - `caja_mensual`: agregar `inventario_cierre` / `base_efectivo` al restore.

## 8. Capa de datos

**`db/faltantes.ts`** (nuevo):

```ts
export type Faltante = { /* espejo de la tabla */ };

// Productos de la muestra del mes (rotación).
productosParaContar(db, muestra: number): Promise<Producto[]>;

// Registra un conteo: marca ultimo_conteo; si hay descuadre, sana el libro
// (finalizarTransaccion) y crea la fila en `faltantes`. Devuelve el faltante o null.
registrarConteo(db, barcode, contado: number): Promise<Faltante | null>;

// Faltantes de un mes / pendientes, para el panel.
listarFaltantes(db, filtro: { mes?: string; soloPendientes?: boolean }): Promise<Faltante[]>;

// Marcar resuelto con nota (quién paga / cómo se manejó).
resolverFaltante(db, id, nota: string): Promise<void>;

// Progreso del ciclo: contados vs total contable.
progresoCiclo(db): Promise<{ contados: number; total: number }>;
```

**`db/reportes.ts`** — `totalFaltantes(db, mes)` (suma `diff_valor`) para el resumen.

**`db/cierres.ts`** o helpers en el módulo mensual — `guardarCierreInventario(db, mes)`
(snapshot) y `getInventarioBase(db, mes)` (lee el cierre del mes anterior).

## 9. Interfaz

- **Nueva pantalla `app/conteo.tsx`** (modal): "Chequeo de inventario del mes".
  Lista los N productos de la rotación; por cada uno, input de cantidad contada
  (con `selectTextOnFocus`, aprendizaje de campo), confirmar → `registrarConteo`.
  Barra de progreso del ciclo. Entrada desde la pantalla de inicio y/o Reportes.
- **Nueva pantalla `app/faltantes.tsx`** (o sección): panel de faltantes con filtro
  mes / pendientes, total, y acción **resolver** (nota + marcar resuelto).
- **Reportes** ([app/(tabs)/reportes.tsx](<app/(tabs)/reportes.tsx>)) — sección
  **"Cuadre del mes"**: bloque financiero (Módulo A, con inventario base y ganancia)
  + resumen del chequeo (progreso, descuadres, enlace al panel) + botón "Cerrar mes"
  que guarda el snapshot de inventario.
- **Ajustes** — campo "Productos a contar por mes" (`conteo_muestra`).

## 10. Validación con datos reales (julio 2026)

| Dato | Valor |
|------|-------|
| Productos activos con stock | 497 |
| Con costo conocido | 146 (29%) → se valoriza **a precio** |
| Inventario a precio | $9.472.000 |
| Muestra 50/mes | cubre los 497 en ~10 meses |

## 11. Decisiones cerradas de valuación

- **Todo a precio de venta** (inventario, cuadre y faltantes). Fiel al método de la
  tesorera (su "valor unitario" era el precio de góndola), único dato completo, y
  consistente con cómo el código ya valoriza colegio/deducciones.
- **Faltante a costo** = mejora futura (no v1), cuando la cobertura de costos sea
  alta. La cobertura crece sola: cada compra guarda el costo del producto.
- El dato "11-12M" del audio era **ilustrativo**, no un valor a cuadrar.

## 12. Alcance por fases

- **Fase 1 (núcleo):** migración v5, `productos.ultimo_conteo`, tabla `faltantes`,
  snapshot de inventario, `db/faltantes.ts`, respaldo, pantalla de conteo, panel de
  faltantes, sección "Cuadre del mes" en Reportes, config de muestra.
- **Fase 2 (opcional):** confirmar identidad del producto con el escáner durante el
  conteo; subir la muestra en meses de cierre "grande"; valuación de faltante a costo
  cuando se conoce.

> **Fuera de alcance:** fiados (descartados) y el cuadre contable exacto A vs B del
> audio. Este plan entrega detección y responsabilización de faltantes sin frenar la
> tienda con conteos totales.
