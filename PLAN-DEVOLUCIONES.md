# Plan: Cambios y devoluciones

Estado: **implementado 2026-08-04, falta probar en runtime**. Documento de trabajo
acordado con el dueño (Tienda Comunal de la Vereda Santa Barbara).

## 1. Objetivo

Manejar en la app las **devoluciones y cambios** de productos ya vendidos: un
cliente vuelve, devuelve lo que compró y (opcional) se lleva otra cosa, con
**reembolso o cobro de la diferencia**. Hoy no hay forma de representarlo: las
ventas quedan infladas porque no se puede revertir una venta.

Caso real: alguien compró salchichas ($9.200) y volvió a cambiarlas por atún
($6.200); se hizo el cambio y se devolvieron $3.000.

## 2. Decisión de modelo (clave): reusar `venta`, sin migración

En vez de un tipo nuevo (que obligaría a reconstruir el CHECK de `transacciones.tipo`
— **rompe la regla aditiva** del repo), una devolución/cambio se persiste como una
**`venta` etiquetada con `categoria = 'devolucion'`** y con **líneas de cantidad
negativa** para lo devuelto:

- `transacciones.categoria` es **TEXT libre** (sin CHECK) → aceptar `'devolucion'`
  no requiere tocar el esquema.
- `transaccion_items.cantidad` **admite negativos** (ya se usa así en ajustes).
- `deltaStock('venta', cantidad)` = `-cantidad` → con `cantidad = -1`, el stock
  **sube +1** (el producto vuelve). Se reusa `finalizarTransaccion` tal cual.

**Resultado: cero migración, cero cambios en el respaldo.** Solo tipos TS + una
pantalla nueva + etiquetas.

## 3. Decisiones acordadas

| Tema | Decisión |
|------|----------|
| **Representación** | `venta` con `categoria='devolucion'`, líneas negativas para lo devuelto. |
| **Un cambio = una sola transacción** | Líneas negativas (devuelve) + positivas (lleva) en la misma venta. `total = neto`. |
| **Reembolso** | **No** es un registro aparte: el neto de ventas ya lo captura (ver §7). Se **muestra** el monto a devolver/cobrar para el cajero. |
| **Precio de reembolso** | Por defecto el **precio actual** del producto, **editable** (por si cambió desde la venta original). |
| **Costo** | La línea devuelta lleva `costo_snapshot = costo actual` → **revierte la utilidad** de esa venta. |
| **Sin vínculo a la venta original** | No hace falta encontrar la transacción original; se escanea/busca el producto y listo. |
| **Tope de stock** | La pata "lleva" reusa el tope normal de venta; la pata "devuelve" **no** lo aplica (suma stock). |

## 4. Flujo

**Devolución pura (solo reembolso):** se escanea lo devuelto → venta
`categoria='devolucion'` con una línea `-1 × $precio`. Stock +1, ventas −$precio.

**Cambio (devuelve A, lleva B):** una venta `categoria='devolucion'` con:
- línea **A**: `cantidad -1`, `precio_unitario_snapshot = $A` (reembolso), `costo_snapshot = costoA`.
- línea **B**: `cantidad +1`, `precio_unitario_snapshot = $B`, `costo_snapshot = costoB`.
- `total = $B − $A` (neto).

**Neto = Σ(lleva) − Σ(devuelve):**
- `< 0` → **reembolsar** \|neto\| al cliente.
- `> 0` → el cliente **paga** la diferencia.
- `= 0` → cambio parejo.

## 5. Cambios de código

- **`db/salidas.ts` / `db/types.ts`** — ampliar el tipo de `categoria`: nuevo
  `type CategoriaTx = CategoriaSalida | 'devolucion'`; `Transaccion.categoria` y
  `NuevaTransaccion.categoria` pasan a `CategoriaTx | null`.
- **`db/transacciones.ts`** — afinar `esSalida` para que **solo** sea colegio/
  deducción (`categoria === 'colegio' || categoria === 'deduccion'`), así una
  devolución (venta) no se trata como salida. `finalizarTransaccion` **se reusa**
  (ya maneja líneas negativas y mixtas: total = suma; `deltaStock` de venta
  devuelve el stock). Opcional: helper `registrarCambio(db, { devuelve, lleva })`
  que arma las líneas con el signo correcto y llama a `finalizarTransaccion`.
- **`db/salidas.ts`** — `etiquetaSalida` (o nuevo `etiquetaTx`) devuelve
  **"Devolución / Cambio"** cuando `categoria === 'devolucion'`, para el historial
  y el detalle.
- **`app/cambio.tsx`** (nuevo, modal) — la pantalla (ver §6).
- **`app/_layout.tsx`** — registrar la ruta `cambio` (modal).
- **`app/(tabs)/index.tsx`** — nueva tarjeta **"Cambio"** (icono `swap-horizontal` /
  `arrow-undo`, color propio). Entra como **tile** en el nuevo grid del home — ver
  [PLAN-HOME-REDISENO.md](PLAN-HOME-REDISENO.md).
- **Sin** cambios en `db/index.ts` (migración) ni `lib/backup.ts`.

## 6. Interfaz — `app/cambio.tsx`

Reusa `ScannerView` / `BuscadorProducto` y el patrón de líneas de
[transaccion/[tipo].tsx](app/transaccion/[tipo].tsx). Dos listas:

1. **"Devuelve" (entra al stock)** — escanear/buscar producto(s); por línea:
   cantidad y **precio de reembolso** (default precio actual, editable). Requerida
   (al menos una).
2. **"Lleva" (sale del stock, opcional)** — escanear/buscar; venta normal con el
   tope de stock. Vacía = devolución pura.

Abajo, el **neto** con etiqueta clara: *"Reembolsar $3.000"* / *"Cobrar $X"* /
*"Cambio parejo"*. Botón **Confirmar** → `finalizarTransaccion` (o `registrarCambio`).
`selectTextOnFocus` en los montos (aprendizaje de campo).

## 7. Impacto en reportes y cierre

- **Ventas** quedan **netas**: la devolución resta lo devuelto. `totalPorTipo('venta')`
  suma el `total` (negativo de la devolución) → correcto.
- **Utilidad**: `utilidadPeriodo` revierte el margen de lo devuelto (por el
  `costo_snapshot` de la línea negativa) y suma el del producto llevado.
- **Salario**: con **efectivo estimado** la base = ventas netas → el salario ya
  sale bien. Con **efectivo contado**, el neto de ventas coincide con la caja física
  (entró menos plata por el reembolso).
- **Inventario / cuadre**: el stock vuelve solo (línea negativa de venta) → el valor
  de inventario queda correcto sin ajustes manuales.
- **Faltantes / liquidación**: sin efectos nuevos; todo cae por las agregaciones por
  rango ya existentes.

## 8. Validación con el ejemplo (salchichas → atún)

Venta original de salchichas: **ventas +$9.200**, stock salchichas −1.
Cambio (una venta `devolucion`): salchichas `-1 (−$9.200)` + atún `+1 (+$6.200)`,
`total = −$3.000`.

| Concepto | Después del cambio |
|---|---|
| Ventas (neto) | 9.200 − 9.200 + 6.200 = **$6.200** ✓ |
| Stock | salchichas de vuelta, atún −1 ✓ |
| Caja | +9.200 − 9.200 + 6.200 = **+$6.200** (= lo que pagó el cliente) ✓ |
| Reembolso mostrado | **$3.000** |

## 9. Alcance y notas

- **Fase única:** tipos, `esSalida`, etiqueta, pantalla `cambio`, tarjeta en inicio,
  ruta. Sin migración ni respaldo.
- **Precisión de la utilidad:** la reversa usa el **costo actual**, no el de la venta
  original (no se enlaza la transacción original). El costo cambia poco → desviación
  menor; se acepta en v1.
- **Historial:** las devoluciones son `tipo='venta'` (aparecen bajo el filtro de
  ventas), etiquetadas "Devolución / Cambio". Un chip de filtro propio queda como
  mejora futura opcional.
- **Fuera de alcance:** anular/editar una transacción arbitraria (pospuesto), y
  vincular la devolución a la venta original.
