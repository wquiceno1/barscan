# Plan: Demo Técnica → Sistema de Inventario para Tienda de Abarrotes

## Estado actual

✅ **Sistema de inventario implementado** (Expo Go, SDK 54). Catálogo, operaciones compra/venta/ajuste con *snapshots* de costo/precio, stock incremental con inventario inicial trazado, productos a granel (código interno `INT-`), historial filtrable y reportes con gráficos. Sigue el diseño de esquema y pantallas de más abajo.

✅ **Respaldo en Firebase implementado y probado** — espejo de una vía a Firestore + recuperación en equipo nuevo (base local vacía → baja el respaldo). Respaldo automático incremental ante cambios + botón manual. **Cambio respecto al plan original:** la autenticación **no** es anónima sino **email/clave (cuenta fija) + ingreso con huella local** en Android, por seguridad real de los datos de ventas. Credenciales por variables `EXPO_PUBLIC_*` (`.env`, fuera del repo; ver `.env.example`). Detalle y pendientes en [docs/respaldo-pendientes.md](docs/respaldo-pendientes.md).

✅ **Mejoras de UX**: mostrar/ocultar contraseña, manejo del teclado (el contenido sube y no tapa los inputs), y **costo unitario editable en compras** (actualiza el costo del producto y, si el precio es por margen, recalcula la venta). La línea de compra/venta muestra: nombre → precio/costo unitario → cantidad → total.

✅ **Build Android para prueba en campo listo**: se configuró **EAS Build** para generar **APK instalable** con perfil `preview`, `android.package = com.barscandemo.app`, `versionCode = 1`, `eas.json` con perfiles `preview` (APK) y `production` (AAB), y scripts `build:android:apk` / `build:android:aab` en `package.json`. El proyecto quedó vinculado a EAS con `owner = wquicenos-team` + `extra.eas.projectId` en `app.json`. Las variables `EXPO_PUBLIC_FIREBASE_*` para builds remotos se cargan en EAS (`preview` / `production`), no desde el `.env` local.

✅ **Prueba en campo realizada con éxito** usando APK instalado en dispositivo Android. La app respondió bien en operación real; quedaron comentarios y ajustes menores para una iteración posterior.

✅ **Ajustes post prueba de campo (iteraciones 1–11)** — derivados del uso real, **ninguno cambia el esquema de la base** (sin migración; `inventario.db` y el respaldo no se afectan). Detalle por iteración en [docs/ajustes-prueba-campo.md](docs/ajustes-prueba-campo.md). Resumen por área:
> - **Ajuste de inventario** (1): stock actual visible, cantidad editable, valores negativos y vista previa del stock resultante.
> - **Catálogo** (2, 9): orden por stock/precio (asc/desc), filtro "stock bajo", indicador visual de agotado/bajo y filtro "Inactivos".
> - **Carga inicial** (3): alta de producto sin código (granel) desde el escáner.
> - **UX de inputs** (1, 6): `selectTextOnFocus` (no hay que borrar el "0"); en compra el costo precarga el costo guardado o, si no hay, el precio de venta como referencia editable.
> - **Búsqueda** (4): insensible a acentos (NFC/NFD) en catálogo, ventas/compras e historial.
> - **Sesión de venta/compra/ajuste** (5, 10, 11): el último producto va arriba de la lista; tope de stock en ventas (botón + desactivado, aviso al escanear de más); resaltado temporal del último agregado.
> - **Reportes** (7): sección "Ventas del día" con selector de fecha (flechas + calendario nativo).
> - **Historial** (8): vista limitada al día seleccionado con el mismo selector.
> - **Ficha de producto** (9): reasignar código, convertir a sin código y desactivar/reactivar (estrategia "retirar + crear", sin borrado físico, respaldo coherente).
>
> **Builds:** `v1.0.1` (iteraciones 1–3), `v1.0.2` (1–8). Las iteraciones **9–11 quedan para el próximo APK** (se mantiene `version = 1.0.2`). La única dependencia nativa nueva es `@react-native-community/datetimepicker` (iteración 7): su **calendario solo aparece en un APK nuevo**.

✅ **Reportes, utilidad y salidas sin venta (v1.0.5)** — features agregadas sobre la 1.0.4:
> - **Reportes imprimibles (PDF)** con `expo-print` + `expo-sharing`: inventario inicial (valorizado a precio de venta) y ventas realizadas (histórico y por período). Detalle en [PLAN-REPORTES-IMPRIMIBLES.md](PLAN-REPORTES-IMPRIMIBLES.md).
> - **Utilidad corregida**: la utilidad del día/mes se calcula **solo sobre ventas con costo conocido** y muestra la cobertura %. Antes tomaba `costo = null` como 0 e inflaba el margen a casi 100%.
> - **Salidas sin venta** (colegio y deducciones: aseo/uso interno, dañado en transporte, vencido, faltante): **restan stock pero no cuentan como venta**, valorizadas a precio de venta, con KPIs de cuadre mensual ("Entregado al colegio", "Deducciones"). Pantalla `app/salida.tsx` + tarjeta en inicio. Detalle en [PLAN-SALIDAS-SIN-VENTA.md](PLAN-SALIDAS-SIN-VENTA.md).
> - **Primera migración de esquema (DB v2)**: se agregan `transacciones.categoria` y `transacciones.subcategoria` (aditiva, nullables → el espejo de respaldo sigue coherente). Esto **actualiza el supuesto previo** de "sin migración" de las iteraciones 1–11; las salidas se persisten como `tipo = 'ajuste'` distinguidas por estas columnas.

✅ **Transporte, salario, liquidación, devoluciones y anulado (v1.0.6 → v1.0.9)**:
> - **v1.0.6** (2026-07-12): **costos de transporte** (fletes) como gasto puro, **salario configurable (7%)** y porcentajes agrupados en Ajustes; en compra, confirmación si el costo supera el precio. Detalle en [PLAN-COSTOS-TRANSPORTE.md](PLAN-COSTOS-TRANSPORTE.md) y [PLAN-AJUSTE-SALARIO.md](PLAN-AJUSTE-SALARIO.md).
> - **v1.0.7** (2026-08-04): salario sobre el **período de liquidación**, **chequeo de inventario por rotación** con registro de **faltantes**, y **liquidación trimestral** ("Liquidar período" en Reportes). Detalle en [PLAN-CUADRE-MENSUAL.md](PLAN-CUADRE-MENSUAL.md).
> - **v1.0.8** (2026-08-04): **cambios y devoluciones** y **rediseño del home** (hero de venta + grilla). Detalle en [PLAN-DEVOLUCIONES.md](PLAN-DEVOLUCIONES.md) y [PLAN-HOME-REDISENO.md](PLAN-HOME-REDISENO.md).
> - **v1.0.9** (2026-08-25): **anular movimientos** revirtiendo el stock, con lápidas (`eliminaciones`) que propagan el anulado a Firestore; barra de progreso del respaldo; reporte de **ventas por producto** (más vendidos / sin ventas).

✅ **Cierre del Período 1** (liquidado el 12/09/2026): primera liquidación real, con análisis patrimonial en [CIERRE-PERIODO-1.md](CIERRE-PERIODO-1.md). **Decisión 2026-09-28:** el Período 2 mantiene el modelo de liquidación por ventas con el 7%.

🔎 **Hallazgos:**
> - **Expo Go ≠ APK.** La base local de Expo Go es **distinta** a la del APK instalado; al probar módulos nuevos en Expo Go solo se ve la data que se haya restaurado de Firebase, no la del APK.
> - **Simbologías de código de barras.** El escáner hoy lee solo **EAN-13/EAN-8/UPC-A/UPC-E** ([components/ScannerView.tsx](components/ScannerView.tsx)). Productos con Code-128/Code-39/ITF o con códigos de **peso/precio variable** no leen de forma fiable → conviene tratarlos como "sin código" (operar por nombre) o, a futuro, ampliar las simbologías soportadas.

🔜 **Pendiente**: pruebas de huella y de respaldo manual; respaldar cambios de solo configuración (margen, salario); registrar lápida al borrar un transporte (ver [PLAN-COSTOS-TRANSPORTE.md](PLAN-COSTOS-TRANSPORTE.md) §5); confirmar en dispositivo devoluciones, home, PDF y chequeo por rotación; completar el §9 de [CIERRE-PERIODO-1.md](CIERRE-PERIODO-1.md); evaluar ampliar simbologías del escáner; y, a futuro, *development build* si se requiere respaldo en background. Ver [docs/respaldo-pendientes.md](docs/respaldo-pendientes.md).

> Historial: la demo técnica de escaneo (validación de cámara + latencia API) está en [Demo técnica (completada)](#demo-técnica-completada). El diseño detallado del sistema sigue vigente más abajo.

---

## Build Android / APK

### Configuración aplicada
- Se adoptó **EAS Build** para distribuir una app instalable fuera de Expo Go.
- `app.json` quedó con `android.package = com.barscandemo.app` y `android.versionCode = 1`.
- `eas.json` define:
  - `preview` → `distribution = internal` + `android.buildType = apk`
  - `production` → `android.buildType = app-bundle`
- `package.json` expone:
  - `npm run build:android:apk`
  - `npm run build:android:aab`
- `eas init` vinculó el proyecto a Expo/EAS y añadió `owner` + `extra.eas.projectId` en `app.json`.

### Variables de entorno para EAS
- El `.env` local sigue siendo válido para desarrollo local.
- **Los builds remotos no leen automáticamente el `.env` local**.
- Para compilar APK/AAB, las variables `EXPO_PUBLIC_FIREBASE_*` deben existir en EAS para el entorno correspondiente:
  - `preview` para `build:android:apk`
  - `production` para `build:android:aab`
- En este proyecto se confirmó que las variables cargadas en EAS llegan correctamente al entorno `preview`.

### Flujo operativo
1. `npx eas-cli@latest login`
2. `npx eas-cli@latest init` (ya realizado)
3. Cargar / verificar `EXPO_PUBLIC_FIREBASE_*` en EAS
4. `npm run build:android:apk`
5. Descargar el APK desde el enlace de EAS e instalarlo en el teléfono

### Resultado
- La compilación para Android quedó lista como parte formal del proyecto.
- La primera prueba en campo se hizo con APK instalado y fue satisfactoria.

---

## Próxima fase — Sistema de Inventario

> Decisiones de arquitectura confirmadas en sesión de planificación (2026-06-17): SQLite = fuente de verdad / Firestore = solo respaldo · target **Expo Go** · stock con conteo inicial + ajustes · soporte de productos a granel.

### Contexto del negocio
- Tienda tradicional de abarrotes y consumo, manejo de todo en papel.
- Dificultad para hacer **balance** por la cantidad de tipos de producto y unidades de cada uno.
- **Un solo usuario** (dueño/encargado), 99% Android.
- Debe funcionar **100% offline** (conectividad inestable es la norma en este tipo de tiendas).

### Arquitectura de datos (decidida)
- **SQLite local (`expo-sqlite`) = única fuente de verdad operativa.** Todo el catálogo y los movimientos viven aquí; la app lee y escribe siempre contra SQLite, online u offline. Funciona en Expo Go.
- **Firestore = solo respaldo (espejo unidireccional).** No se lee desde Firestore en operación normal; sirve únicamente para recuperar los datos si se pierde/cambia el teléfono. Se descartó usarlo como base offline-first para no tener dos bases locales con lógica de reconciliación.
- **Cómo se respalda (en Expo Go):** Firebase **JS SDK** (no nativo). Cada fila modificada se marca con `synced=0` + `updated_at`; un proceso ligero empuja los pendientes a colecciones espejo en Firestore (`productos`, `transacciones`, `transaccion_items`) **mientras la app está abierta y hay red**, y los marca `synced=1`. Filas pequeñas → muy por debajo del límite de 1 MB por documento.
- **Limitación asumida del target Expo Go:** no hay sincronización real con la app cerrada (eso exigiría *development build* + tareas nativas en background). El respaldo corre al abrir la app / al recuperar conexión con la app en uso. Aceptable para un solo usuario que abre la app a diario. (Si en el futuro se quiere respaldo en background del SO o Firebase nativo, hay que migrar a dev build / EAS.)
- Sin sincronización multi-dispositivo/usuario (alcance actual: un solo dispositivo).

### Carga inicial del catálogo
- No existe listado digital previo → se construye con una **sesión dedicada de escaneo**: recorrer la tienda escaneando cada producto y completando sus datos ahí mismo.
- Por producto nuevo, dos modos de precio (selector en el formulario):
  - **"Calcular con margen"** → ingresas costo, la app sugiere precio = costo × (1 + margen%).
  - **"Precio fijo"** → ingresas el precio directo, sin cálculo (costo opcional, solo referencial).
- **% de margen general** configurable en ajustes, con posibilidad de override por producto específico.
- **Conteo inicial de stock:** al dar de alta cada producto se captura su **cantidad inicial** (`stock_actual` de arranque). Queda registrado como un movimiento de "inventario inicial" para trazabilidad (ver tipo `ajuste`).

### Productos a granel / sin código de barras (confirmado: existen)
- Vía de **alta y búsqueda manual por nombre**, paralela al escaneo, sin entorpecer el flujo principal.
- A cada producto sin código se le asigna un **código interno autogenerado** (ej. prefijo `INT-` + correlativo) que ocupa el mismo campo `barcode`, para que el resto del modelo (líneas de transacción, reportes) no necesite casos especiales.
- En las pantallas de compra/venta debe existir un botón **"Agregar sin escanear"** que abre el buscador por nombre.

### Manejo de stock y exactitud (decidido)
- `stock_actual` por producto se mantiene incrementalmente: **compra (+)**, **venta (−)**, **ajuste (±)**.
- **Tipo de transacción `ajuste`** para mantener el stock fiel a la realidad: merma, caducidad, robo, conteo físico, e inventario inicial. Cada ajuste guarda un **motivo** (texto/categoría) para trazabilidad y para no contaminar los reportes de ventas/compras.
- Los reportes de dinero (ventas, compras, utilidad) **no** cuentan los `ajuste` como ingreso/egreso; los ajustes solo afectan stock (y, si se desea, una métrica separada de "merma valorizada").

### Operación diaria — transacciones agrupadas (modo sesión explícito)
1. El usuario presiona **"Nueva compra"**, **"Nueva venta"** o **"Ajuste de inventario"**.
2. Agrega productos por **escaneo** o con **"Agregar sin escanear"** (búsqueda por nombre, para granel): cada producto nuevo agrega una línea (producto, cantidad=1, precio unitario, subtotal); **re-escanear el mismo código incrementa la cantidad** de su línea (no duplica) — imita el gesto de pasar cada unidad por el lector.
3. Cantidad ajustable manualmente (+/-) para casos donde escanear N veces no es práctico (ej. compra por mayor).
4. **Total visible en tiempo real**, sumando todas las líneas (no aplica a `ajuste`).
5. Ingreso opcional de **nombre de cliente/proveedor** (texto libre) — en `ajuste`, opcional **motivo**.
6. **"Finalizar"** → guarda la transacción con: `id`, `tipo` (compra/venta/ajuste), `fecha_hora`, `cliente_proveedor`, `motivo?`, `items[]`, **`total`**, y aplica los deltas a `stock_actual`.

> **Decisión de modelado clave**: cada ítem de la transacción guarda un *snapshot* del precio/costo **al momento de la operación** (no una referencia al precio actual del catálogo). Sin esto, los reportes de meses anteriores quedarían distorsionados cuando los precios cambien.

### Trazabilidad
- Historial de operaciones filtrable por fecha, tipo (compra/venta/ajuste) y cliente/proveedor (texto libre).
- Sin lógica de deudas/créditos pendientes — solo registro ordenado para seguimiento.

### Balance / Reportes (módulo de analítica)
Ejemplos del usuario:
- Valor en dinero del stock disponible.
- Total de operaciones por día/semana/mes.
- Gráfico histórico de esos totales (semana/mes).
- Gasto en compras a proveedores del mes.

Sugerencias adicionales que se derivan del mismo modelo de datos sin rediseño:
- **Utilidad/margen real del período** (ventas − costo de lo vendido), posible gracias al snapshot de costo+precio.
- **Ranking de productos**: más vendidos (por unidades o ingreso) y productos sin movimiento ("stock estancado").
- **Valor del inventario en dos vistas**: al costo (inversión) vs al precio de venta (ganancia potencial).
- **Ticket promedio de venta**.
- **Comparativas entre períodos** (mes actual vs anterior, % de variación).
- **Top proveedores por gasto acumulado**.

El usuario indicó que seguirá refinando esta lista con el uso real de la app — el modelo de datos (transacciones con ítems + totales + snapshots fechados) soporta nuevas métricas sin cambios estructurales.

### Modelo de datos (borrador para diseñar en la próxima sesión)
- `productos`: `barcode` (PK; código real o interno `INT-...` para granel), `nombre`, `sin_codigo` (bool, granel), `costo`, `precio`, `modo_precio` (margen/fijo), `margen_pct` (override, nullable), `stock_actual`, `categoria?`, `updated_at`, `synced` (0/1)
- `transacciones`: `id`, `tipo` (compra/venta/ajuste), `fecha_hora`, `cliente_proveedor?`, `motivo?` (para ajuste), `total`, `updated_at`, `synced`
- `transaccion_items`: `transaccion_id`, `barcode`, `nombre_snapshot`, `cantidad` (puede ser ± en ajuste), `costo_snapshot`, `precio_unitario_snapshot`, `subtotal`, `synced`
- `configuracion`: `margen_general_pct`
- *Nota:* `costo_snapshot` en los ítems es lo que habilita el cálculo de utilidad/margen real del período.

### Pendiente para la próxima sesión — ✅ resuelto
> Lista de la etapa de diseño (junio 2026). Todo quedó hecho: el esquema y las pantallas están más abajo, y el respaldo en Firebase arriba (con auth email/clave en vez de anónima).

- Diseñar el esquema definitivo SQLite (`expo-sqlite`) con los campos `synced`/`updated_at` para el espejo incremental a Firestore (JS SDK).
- Definir el proyecto Firebase + reglas de seguridad mínimas (auth anónima) para el respaldo.
- Definir pantallas: carga inicial, nueva compra/venta, ajuste de inventario, buscador de productos (granel), historial/trazabilidad, reportes.
- Gráficos del módulo de reportes: **`react-native-chart-kit`** (JS puro, compatible con Expo Go). `victory-native` queda descartado mientras sigamos en Expo Go (usa Skia → dev build).
- Definir cómo evoluciona el código de la demo actual hacia este sistema (reusar el flujo de escaneo + modal ya construido y probado).

---

## Diseño técnico — Esquema SQLite + Pantallas

> Diseñado el 2026-06-17. Target Expo Go / SDK 54, `expo-sqlite` (API async). **Plan básico**: SQLite = verdad, Firestore = espejo de respaldo (no incluido en este diseño de esquema, solo se reservan los campos `synced`/`updated_at`).

### Convenciones
- **Dinero = enteros en pesos colombianos (COP)** (sin decimales; los centavos no se usan en la práctica). Los cálculos con margen redondean al peso (`ROUND`). Si en el futuro se usa una moneda con centavos, migrar a enteros de centavos.
- **Fechas = TEXT en ISO 8601** local (`YYYY-MM-DDTHH:mm:ss`), para que los filtros por rango y los `GROUP BY` por día/mes funcionen con comparación de strings.
- **IDs = TEXT (UUID v4)** para transacciones e ítems (evita colisiones y facilita el espejo a Firestore con el mismo id de documento).
- **Borrado lógico** (`activo = 0`) en productos: nunca se borra físico, así los snapshots históricos y el espejo siguen siendo válidos.
- **`synced` (0/1) + `updated_at`** en las filas respaldables: el job de respaldo selecciona `WHERE synced = 0`, sube el documento a Firestore con su id y marca `synced = 1`. Sin tombstones porque el borrado es lógico.

### Esquema (DDL)

```sql
-- Al abrir la base:
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- v1 ---------------------------------------------------------------
CREATE TABLE productos (
  barcode        TEXT PRIMARY KEY,                 -- EAN/UPC real o interno 'INT-000123'
  nombre         TEXT    NOT NULL,
  sin_codigo     INTEGER NOT NULL DEFAULT 0,       -- 1 = granel / sin código de barras
  categoria      TEXT,
  modo_precio    TEXT    NOT NULL DEFAULT 'margen' -- 'margen' | 'fijo'
                   CHECK (modo_precio IN ('margen','fijo')),
  costo          INTEGER,                          -- COP; nullable en 'fijo'
  margen_pct     REAL,                             -- override; NULL = usa margen_general_pct
  precio         INTEGER NOT NULL,                 -- COP; precio de venta vigente
  stock_actual   INTEGER NOT NULL DEFAULT 0,
  activo         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL,
  synced         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE transacciones (
  id                TEXT PRIMARY KEY,              -- UUID
  tipo              TEXT NOT NULL
                      CHECK (tipo IN ('compra','venta','ajuste')),
  fecha_hora        TEXT NOT NULL,                 -- ISO 8601 local
  cliente_proveedor TEXT,                          -- texto libre, opcional
  motivo            TEXT,                          -- solo 'ajuste' (merma, caducidad, conteo, inventario inicial)
  total             INTEGER NOT NULL DEFAULT 0,    -- COP; 0 en 'ajuste'
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  synced            INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE transaccion_items (
  id                       TEXT PRIMARY KEY,       -- UUID
  transaccion_id           TEXT NOT NULL
                             REFERENCES transacciones(id) ON DELETE CASCADE,
  barcode                  TEXT NOT NULL,          -- referencia laxa (sin FK): el snapshot debe sobrevivir
  nombre_snapshot          TEXT NOT NULL,
  cantidad                 INTEGER NOT NULL,       -- >0 en compra/venta; ± en ajuste
  costo_snapshot           INTEGER,                -- COP al momento de la operación
  precio_unitario_snapshot INTEGER NOT NULL,       -- COP al momento de la operación
  subtotal                 INTEGER NOT NULL,       -- cantidad * precio_unitario_snapshot
  synced                   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE configuracion (
  clave TEXT PRIMARY KEY,                          -- 'margen_general_pct', 'moneda', 'correlativo_interno', ...
  valor TEXT NOT NULL
);

-- Índices
CREATE INDEX idx_tx_fecha        ON transacciones(fecha_hora);
CREATE INDEX idx_tx_tipo_fecha   ON transacciones(tipo, fecha_hora);
CREATE INDEX idx_items_tx        ON transaccion_items(transaccion_id);
CREATE INDEX idx_items_barcode   ON transaccion_items(barcode);     -- rankings de productos
CREATE INDEX idx_prod_nombre     ON productos(nombre);              -- búsqueda granel
CREATE INDEX idx_prod_activo     ON productos(activo);
-- Para el job de respaldo (parciales, livianos):
CREATE INDEX idx_prod_unsynced   ON productos(synced)      WHERE synced = 0;
CREATE INDEX idx_tx_unsynced     ON transacciones(synced)  WHERE synced = 0;
CREATE INDEX idx_items_unsynced  ON transaccion_items(synced) WHERE synced = 0;
```

### Reglas de negocio sobre el esquema
- **Aplicación de stock al finalizar** (dentro de una `withTransactionAsync`): `compra → stock += cantidad`; `venta → stock -= cantidad`; `ajuste → stock += cantidad` (cantidad puede ser negativa).
- **Inventario inicial** = transacción `ajuste` con `motivo = 'inventario inicial'` y un ítem por producto con la cantidad contada. Así el stock de arranque queda trazado, no "aparecido de la nada".
- **Cálculo de precio sugerido** (modo margen): `precio = ROUND(costo * (1 + margen_efectivo/100))`, donde `margen_efectivo = COALESCE(productos.margen_pct, configuracion.margen_general_pct)`. El precio se materializa en `productos.precio` (no se recalcula al vuelo) para que el catálogo sea estable y la venta tome un valor fijo.
- **Reportes de dinero ignoran `ajuste`**: ventas/compras/utilidad filtran `tipo IN ('venta','compra')`. La merma valorizada, si se quiere, sale de `tipo = 'ajuste' AND cantidad < 0` usando `costo_snapshot`.
- **`total` se valida**: al finalizar, `total == SUM(subtotal de sus ítems)`.

### Migraciones (`expo-sqlite`, patrón `user_version`)
```ts
const DB_NAME = 'inventario.db';
const TARGET_VERSION = 1;

export async function openDb() {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

  let { user_version = 0 } =
    (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version')) ?? {};

  if (user_version < 1) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(/* DDL v1 de arriba */);
      await db.runAsync(
        "INSERT OR IGNORE INTO configuracion (clave, valor) VALUES ('margen_general_pct','30'), ('moneda','COP'), ('correlativo_interno','0')"
      );
    });
    await db.execAsync('PRAGMA user_version = 1');
    user_version = 1;
  }
  // if (user_version < 2) { ... } futuras migraciones aditivas
  return db;
}
```
Las migraciones futuras son **aditivas** (nuevas tablas/columnas, nunca renombrar/borrar) para no romper el espejo de respaldo.

### Estructura de pantallas (Expo Router, file-based)
Adoptar **`expo-router`** (estándar Expo, funciona en Expo Go) con **tabs inferiores**. Esto cambia el layout del proyecto: el `App.tsx` actual se descompone en rutas dentro de `app/`. El motor de escaneo de la demo (`CameraView` + pausa + modal) se extrae a un componente reutilizable.

```
app/
├── _layout.tsx                 # Stack raíz + init de la DB (openDb)
├── (tabs)/
│   ├── _layout.tsx             # Tabs inferiores
│   ├── index.tsx               # OPERAR: botones grandes Venta / Compra / Ajuste
│   ├── catalogo.tsx            # Lista + búsqueda de productos; FAB "Agregar"
│   ├── historial.tsx           # Lista de transacciones + filtros (fecha/tipo/contraparte)
│   ├── reportes.tsx            # Métricas + gráficos (react-native-chart-kit)
│   └── ajustes.tsx             # Margen general, moneda, estado de respaldo/sync, exportar
├── transaccion/
│   └── [tipo].tsx              # SESIÓN compra|venta|ajuste: scanner + líneas + total + finalizar
├── producto/
│   ├── nuevo.tsx               # Alta de producto (formulario; precandidato desde un scan)
│   └── [barcode].tsx           # Editar producto / ver stock y movimientos
├── carga-inicial.tsx           # Modo escaneo continuo: nuevo→alta, existente→ajuste de conteo
└── detalle/
    └── [id].tsx                # Detalle de una transacción (ítems + total)
```

Componentes compartidos (`components/`):
- `ScannerView` — `CameraView` con pausa anti-metralleta (extraído de la demo).
- `BuscadorProducto` — modal de búsqueda por nombre, para "Agregar sin escanear" (granel) y para el catálogo.
- `LineaItem` — fila editable (cantidad +/-, subtotal) usada en la sesión de transacción.

Flujos clave:
- **Sesión de transacción** (`transaccion/[tipo]`): scanner activo → código nuevo agrega línea (cant=1) / re-escaneo incrementa; botón "Agregar sin escanear" abre `BuscadorProducto`; si el código no existe en catálogo, ofrece alta rápida (`producto/nuevo` con el barcode precargado) y vuelve a la sesión. Total en vivo. "Finalizar" persiste en una transacción atómica y aplica stock.
- **Carga inicial** (`carga-inicial`): pensada para la primera puesta en marcha; escaneo continuo donde cada producto desconocido salta a alta con conteo inicial, y los conocidos permiten corregir el conteo.

### Capa de datos (`db/`)
- `db/index.ts` — `openDb()` + migraciones (arriba).
- `db/productos.ts`, `db/transacciones.ts`, `db/reportes.ts` — funciones tipadas (`getAllAsync`/`runAsync`) que encapsulan el SQL; las pantallas nunca escriben SQL crudo.
- Cada `INSERT`/`UPDATE` setea `updated_at = now()` y `synced = 0`.

---

## Demo técnica (completada)

Prueba de concepto minimalista para validar:
1. Rendimiento del **escaneo continuo** de códigos EAN-13 / UPC en tiempo real.
2. **Velocidad de respuesta** al consultar Open Food Facts.

Target: **Expo Go**.

### Decisión técnica clave
Para **Expo Go**, `react-native-vision-camera` **no es viable** (requiere *development build* nativo). Se usó **`expo-camera`** con `CameraView` y `onBarcodeScanned`.

> **Nota sobre versión de SDK**: el proyecto se creó inicialmente con Expo SDK 56 (la última disponible vía `create-expo-app`), pero **Expo Go publicado en la Play Store solo soportaba hasta SDK 54** en ese momento (SDK 56 era demasiado reciente para haber llegado a las tiendas). Se bajó el proyecto a `expo@^54.0.0` con `npx expo install --fix` + reinstalación limpia de `node_modules` para alinear todas las dependencias. Si en el futuro se actualiza Expo Go en la tienda, se puede subir el SDK del proyecto nuevamente.

### Decisiones del usuario
- **Lenguaje:** TypeScript
- **Anti-metralleta:** pausar escaneo (cámara viva, se ignoran lecturas mientras el modal está abierto)
- **Métricas:** mostrar **latencia de la API en ms** en el modal
- **Idioma UI:** Español

### Implementación (resumen)
- `App.tsx`: pantalla única con `CameraView` a pantalla completa, `barcodeScannerSettings` para EAN-13/EAN-8/UPC-A/UPC-E, `onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}` (pausa canónica), fetch a Open Food Facts con medición de latencia (`Date.now()`), y Modal con spinner / nombre del producto / mensaje de error / latencia / botón "Escanear de nuevo".
- `app.json`: plugin `expo-camera` con permiso de cámara en español.
- Botón flotante "↻ Reiniciar escáner".

### Verificación realizada
- `tsc --noEmit` sin errores.
- `expo export --platform android` empaqueta el bundle correctamente (580 módulos).
- `npx expo install --check` confirma dependencias alineadas con SDK 54.
- Pendiente de prueba manual en dispositivo físico con Expo Go (requiere cámara real).
