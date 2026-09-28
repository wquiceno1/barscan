# Plan: Salidas sin venta (Colegio y Deducciones)

Estado: **fase 1 implementada** (2026-07-09) **y en uso**: el Cierre del Período 1
registra $221.500 en deducciones y $148.900 entregados al colegio
([CIERRE-PERIODO-1.md](CIERRE-PERIODO-1.md)). Documento de trabajo acordado con el
dueño (Tienda Comunal de la Vereda Santa Barbara).

Implementación (fase 1): migración v2 (`categoria`/`subcategoria` en
`transacciones`), `db/salidas.ts` (vocabulario + labels), `finalizarTransaccion`
con salidas categorizadas, restore del respaldo, token/variante `salida`, tarjeta
"Salida sin venta" en inicio, pantalla `app/salida.tsx` con selector, funciones
`salidasColegio`/`deducciones` + KPIs en Reportes, y etiquetas en historial/detalle.
Typecheck limpio. Fase 2 sigue opcional.

## 1. Objetivo

Capturar dos flujos de mercadería que **sale del inventario sin ser una venta**,
para poder cuadrar a fin de mes:

1. **Colegio** — el colegio local está autorizado a llevarse productos (aseo y
   otros) sin pagar. Hay que llevar la cuenta de cuánto se entregó.
2. **Deducciones** — gastos/bajas internas de la tienda, con subcategoría:
   - Aseo / uso interno
   - Dañado en transporte
   - Vencido / caducado
   - Faltante / robo

Ambos flujos **restan stock** pero **no suman al total de ventas**. Se registran
por una sola interfaz con un selector para elegir el tipo.

## 2. Decisiones acordadas

| Tema | Decisión |
|------|----------|
| Valorización | **Precio de venta** (`productos.precio`). Es lo siempre disponible y refleja el valor de la mercadería que salió. Se guarda también `costo_snapshot` para el futuro, pero el cuadre se muestra a precio de venta. |
| Subcategorías de deducción | Las 4: aseo/uso interno, dañado en transporte, vencido/caducado, faltante/robo. |
| Impacto en utilidad | **Solo totales separados.** No restan de la "Utilidad del mes" (que sigue siendo margen sobre ventas). Se muestran como líneas aparte para el cuadre. |
| Efecto en inventario | Restan `stock_actual` (salida). |
| Efecto en ventas | No entran en ningún cálculo de ventas (`tipo='venta'`). |

## 3. Modelo de datos

**No se agrega un `tipo` nuevo.** El `CHECK (tipo IN ('compra','venta','ajuste'))`
obligaría a reconstruir la tabla `transacciones`, lo cual **viola la regla de
migraciones aditivas** ([db/index.ts](db/index.ts)) y arriesga el espejo de
respaldo. Además, la nota del plan de reportes ya preveía que estas bajas fueran
de tipo `ajuste`.

Entonces: estas salidas se persisten como **`tipo = 'ajuste'`**, distinguidas por
**dos columnas nuevas (aditivas)** en `transacciones`:

| Columna | Tipo | Valores |
|---------|------|---------|
| `categoria` | TEXT (null) | `null` = ajuste normal (corrección/conteo) · `'colegio'` · `'deduccion'` |
| `subcategoria` | TEXT (null) | Solo si `categoria='deduccion'`: `'aseo'` · `'transporte'` · `'vencido'` · `'faltante'` |

- `motivo` se conserva como **nota libre opcional** (p. ej. quién del colegio pasó).
- Se distinguen limpiamente de los ajustes de corrección de conteo (que llevan
  `categoria = null`).

### Valorización y signo

Para estas salidas, cada línea guarda:
- `cantidad` = **unidades que salieron** (positivo).
- `precio_unitario_snapshot` = `producto.precio` al momento.
- `costo_snapshot` = `producto.costo` al momento (para el futuro; puede ser null).
- `subtotal` = `cantidad * precio` (positivo).

Y la cabecera `transacciones.total` = suma de subtotales (**> 0**, a diferencia
del ajuste de corrección que sigue en 0).

> Nota: hoy `types.ts` documenta `total = 0` en 'ajuste'. Eso deja de ser cierto
> para los ajustes con `categoria` de salida; se actualiza el comentario. Ningún
> reporte de ventas se ve afectado porque todos filtran `tipo='venta'`.

### Signo del stock

`deltaStock` hoy hace: `venta → −cantidad`, resto `→ +cantidad`. Para no meter
cantidades negativas (que ensuciarían `subtotal`), la lógica de guardado tratará
un ajuste **con categoría de salida** como una resta: `delta = −cantidad` aunque
`tipo='ajuste'`. Así `cantidad` y `subtotal` quedan positivos y limpios para los
reportes, y el stock baja correctamente.

## 4. Migración y respaldo

1. **`db/index.ts`** — subir `TARGET_VERSION` a 2 y agregar bloque
   `if (userVersion < 2)`:
   ```sql
   ALTER TABLE transacciones ADD COLUMN categoria    TEXT;
   ALTER TABLE transacciones ADD COLUMN subcategoria TEXT;
   ```
   (Aditivo. `DDL_V1` no se toca: las instalaciones nuevas corren v1 y luego el
   ALTER de v2.)
2. **`lib/backup.ts`** — la subida usa `SELECT *`, así que las columnas nuevas se
   respaldan solas. El **restore** ([backup.ts:267](lib/backup.ts#L267)) tiene la
   lista de columnas a mano: hay que **agregar `categoria` y `subcategoria`** al
   `INSERT OR REPLACE INTO transacciones (...)`.
3. **`db/types.ts`** — agregar `categoria` y `subcategoria` a `Transaccion`;
   nuevos tipos:
   ```ts
   export type CategoriaSalida = 'colegio' | 'deduccion';
   export type SubcatDeduccion = 'aseo' | 'transporte' | 'vencido' | 'faltante';
   ```

## 5. Lógica de guardado

**`db/transacciones.ts`** — extender `NuevaTransaccion` y `finalizarTransaccion`:

```ts
export type NuevaTransaccion = {
  tipo: TipoTransaccion;
  cliente_proveedor?: string | null;
  motivo?: string | null;
  categoria?: CategoriaSalida | null;      // nuevo
  subcategoria?: SubcatDeduccion | null;   // nuevo
  lineas: LineaBorrador[];
};
```

- Es "salida categorizada" si `categoria != null`.
- Para salida: `total = Σ(cantidad * precio_unitario_snapshot)`; `delta = −cantidad`.
- Persistir `categoria` y `subcategoria` en la cabecera.
- El resto (snapshots por línea, atomicidad) igual que hoy.

## 6. Interfaz

**Pantalla de inicio** ([app/(tabs)/index.tsx](app/(tabs)/index.tsx)) — nueva
acción bajo "Ajuste de inventario":

- **"Salida sin venta"** · desc "Entrega al colegio o deducciones (aseo, vencidos…)"
  · icono p. ej. `exit-outline` · color propio (o reusar `colors.ajuste`).

**Nueva pantalla** `app/salida.tsx` (dedicada, más clara que sobrecargar
`[tipo].tsx`):

1. **Selector 1:** Colegio · Deducción.
2. Si Deducción → **Selector 2** de subcategoría (aseo · transporte · vencido ·
   faltante).
3. Nota libre opcional (→ `motivo`).
4. Escaneo/búsqueda + líneas con **cantidad que sale** (positivo), mostrando
   "stock actual → resultante" (como el ajuste).
5. **Total en vivo** valorizado a precio de venta.
6. Guardar → `finalizarTransaccion({ tipo:'ajuste', categoria, subcategoria, ... })`.

> Se pueden extraer los componentes de línea de `[tipo].tsx` para reusarlos, o
> partir de una versión recortada del flujo de venta (cantidades positivas que
> restan stock). Decisión de implementación.

## 7. Reportes / cuadre

**`db/reportes.ts`** — nuevas funciones (por rango [desde, hasta]):

```ts
// Total y unidades entregadas al colegio.
salidasColegio(db, rango): Promise<{ unidades: number; total: number }>;

// Deducciones desglosadas por subcategoría + total.
deducciones(db, rango): Promise<{
  filas: { subcategoria: SubcatDeduccion; unidades: number; total: number }[];
  total: number;
}>;
```

Ambas: `JOIN` items↔transacciones, `WHERE t.categoria = 'colegio'` /
`'deduccion'` (+ `GROUP BY subcategoria`), `SUM(i.subtotal)`.

**Pantalla Reportes** ([app/(tabs)/reportes.tsx](app/(tabs)/reportes.tsx)) — en la
sección "Ventas por mes", nuevas KPIs (no tocan la utilidad):

- **"Entregado al colegio"** — $ del mes.
- **"Deducciones"** — $ del mes, con desglose por subcategoría (caption o filas).

**PDF de cuadre mensual (fase 2, opcional):** un reporte imprimible que combine
ventas del mes + colegio + deducciones (desglose), reusando
[lib/reportePdf.ts](lib/reportePdf.ts). Útil para el cuadre de fin de mes en papel.

## 8. Historial y detalle

- **`app/(tabs)/historial.tsx`** y **`app/detalle/[id].tsx`** — hoy muestran estas
  transacciones como "Ajuste". Mapear `categoria`/`subcategoria` a una etiqueta
  legible ("Colegio", "Deducción · Vencido") y, si se quiere, color/icono propio.
- Opcional: filtro por categoría en el historial.

## 9. Inventario inicial: cerrado (decisión tomada)

El dueño **dio por cerrado** el inventario inicial: es un snapshot histórico y no
se seguirá reconstruyendo. Por lo tanto:

- **`inventarioInicial` NO se modifica.** No se suman de vuelta colegio ni
  deducciones. La fórmula queda como está.
- Estas salidas son **registro de ahora en adelante**; su propósito es el cuadre
  mensual, no re-derivar el punto de arranque.

Efecto colateral aceptado: como son `ajuste`, si en el futuro se regenerara el PDF
de inventario inicial, su total iría bajando con las salidas acumuladas (igual que
ya pasa con cualquier ajuste). No importa, porque ese reporte no se seguirá
usando.

## 10. Alcance por fases

- **Fase 1 (núcleo):** migración v2, tipos, `finalizarTransaccion`, pantalla
  `salida.tsx`, acción en inicio, restore del respaldo, KPIs de colegio y
  deducciones en Reportes, etiquetas en historial/detalle.
- **Fase 2 (opcional):** PDF de cuadre mensual; filtro por categoría en historial.
