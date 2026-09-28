# Plan: Costos de transporte

Estado: **fase 1 implementada** (2026-07-12, v1.0.6) **y en uso**: el Cierre del
Período 1 (12/09/2026) registra $584.000 de transporte
([CIERRE-PERIODO-1.md](CIERRE-PERIODO-1.md)). Fase 2 (foto del recibo) pendiente.
Documento de trabajo acordado con el dueño (Tienda Comunal de la Vereda Santa Barbara).

## 1. Objetivo

Registrar los **costos de transporte pagados** (fletes al traer mercadería). Es un
**gasto puro**: sale dinero pero **no** entra ni sale inventario. No es compra,
venta ni ajuste — es un concepto nuevo en el modelo.

Por cada pago se captura: **costo**, **detalle**, **transportador** y (en una fase
2) una **foto del recibo** físico.

## 2. Decisiones acordadas

| Tema | Decisión |
|------|----------|
| Foto del recibo | **Sin foto por ahora.** Se implementa en fase 2. Se reserva la columna `foto` desde ya para no requerir otra migración. |
| Alcance | **Solo transporte** (módulo dedicado, no un gastos general). |
| Reportes | **Sí**, con total mensual ("Transporte del mes"). |
| Efecto en stock | **Ninguno** (no toca inventario). |
| Efecto en ventas/utilidad | **Ninguno** (es un gasto aparte; no se mezcla con ventas/compras). |

## 3. Modelo de datos

**Tabla nueva `transportes`** (no se reusa `transacciones`: un flete no tiene
productos ni movimiento de stock). Migración **aditiva** (tabla nueva), coherente
con la regla del repo.

| Columna | Tipo | Nota |
|---------|------|------|
| `id` | TEXT PK | UUID |
| `fecha_hora` | TEXT | ISO local; por defecto hoy |
| `monto` | INTEGER | COP pagado (> 0) |
| `transportador` | TEXT | quién recibió el pago (texto libre, opcional) |
| `detalle` | TEXT | descripción del flete (opcional) |
| `foto` | TEXT | **reservada** para fase 2 (ruta/URL del recibo); null por ahora |
| `created_at` / `updated_at` | TEXT | |
| `synced` | INTEGER | 0/1 para el espejo de respaldo |

```sql
CREATE TABLE IF NOT EXISTS transportes (
  id            TEXT PRIMARY KEY,
  fecha_hora    TEXT NOT NULL,
  monto         INTEGER NOT NULL,
  transportador TEXT,
  detalle       TEXT,
  foto          TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  synced        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_transportes_fecha    ON transportes(fecha_hora);
CREATE INDEX IF NOT EXISTS idx_transportes_unsynced ON transportes(synced) WHERE synced = 0;
```

## 4. Migración y respaldo

1. **`db/index.ts`** — subir `TARGET_VERSION` a **3** y agregar bloque
   `if (userVersion < 3)` con el `CREATE TABLE`/índices de arriba
   (`PRAGMA user_version = 3`).
2. **`lib/backup.ts`** — agregar `'transportes'` a `TABLAS_SYNC` y sumarla a:
   - **Subida** (`respaldar`): leer `SELECT * FROM transportes WHERE synced = 0`,
     empujar a la colección `transportes` y marcar `synced = 1`.
   - **Restore** (`restaurar`): `INSERT OR REPLACE INTO transportes (...)`.
   - **Estado** (`estadoRespaldo`): incluir su conteo de pendientes.
   - **Reconstrucción** (`marcarTodoPendienteRespaldo`): incluir la tabla.

## 5. Capa de datos — `db/transportes.ts` (nuevo)

```ts
export type Transporte = {
  id: string;
  fecha_hora: string;
  monto: number;
  transportador: string | null;
  detalle: string | null;
  foto: string | null;
  created_at: string;
  updated_at: string;
  synced: number;
};

// Crea un registro de transporte. fecha_hora por defecto = ahora.
crearTransporte(db, datos: {
  monto: number;
  transportador?: string | null;
  detalle?: string | null;
  fecha_hora?: string;
}): Promise<string>;

// Lista (opcionalmente por rango [desde, hasta]), más reciente primero.
listarTransportes(db, rango?): Promise<Transporte[]>;

// Total pagado en transporte en un rango (para Reportes).
totalTransporte(db, rango): Promise<number>;

// Borra un registro (para corregir errores).
eliminarTransporte(db, id): Promise<void>;
```

Cada `INSERT`/`UPDATE`/`DELETE` marca `updated_at`/`synced = 0` como el resto de
la capa de datos.

> Nota sobre borrado: hoy el respaldo es un espejo de una vía sin tombstones. Si
> se borra un transporte localmente, no se elimina solo del respaldo remoto (igual
> que el resto del modelo). Para v1 es aceptable; se corrige a mano si hace falta.
>
> **Actualización 2026-09-28:** desde v1.0.9 el respaldo sí tiene lápidas (tabla
> `eliminaciones`), pero solo las registra el anulado de movimientos
> (`db/transacciones.ts`). `eliminarTransporte` sigue haciendo un `DELETE` físico
> sin lápida, así que un transporte borrado queda en Firestore y **vuelve** con
> "Restaurar desde la nube". Pendiente: registrar la lápida al borrar.

## 6. Interfaz

**Pantalla de inicio** ([app/(tabs)/index.tsx](app/(tabs)/index.tsx)) — nueva
tarjeta (la 5.ª):

- **"Costo de transporte"** · desc "Registrar un flete pagado" · icono `bus`
  (o `car`) · color propio (nuevo token `colors.transporte`, p. ej. índigo).

**Nueva pantalla** `app/transporte.tsx` (modal, como las demás operaciones):

1. **Monto** (input numérico, obligatorio, > 0).
2. **Transportador** (texto, opcional).
3. **Detalle** (texto, opcional).
4. **Fecha** (por defecto hoy; editable con el date picker ya usado en Reportes).
5. Botón **Guardar** → `crearTransporte(...)` + `toast`.
6. Debajo, **lista de los transportes del mes** (monto · transportador · fecha)
   con opción de **borrar** cada uno, para revisar y corregir sin salir.

> El botón/entrada de **foto** NO se incluye en v1 (fase 2). La columna ya queda
> reservada.

**Ruta** — registrar `transporte` en [app/_layout.tsx](app/_layout.tsx) como modal.

## 7. Reportes

- **`db/reportes.ts`** (o reusar `totalTransporte` de `db/transportes.ts`) — total
  de transporte por rango.
- **Pantalla Reportes** ([app/(tabs)/reportes.tsx](app/(tabs)/reportes.tsx)) — en
  "Ventas por mes", nuevo KPI **"Transporte"** (junto a Compras), con el color del
  módulo. Se agrega al `Promise.all` mensual y al tipo `DatosMes`.

> No se resta de ninguna otra métrica; es un total informativo para el cuadre,
> igual que "Entregado al colegio" y "Deducciones".

## 8. Foto del recibo (fase 2)

Cuando se retome:
- Captura con **`expo-image-picker`** (cámara o galería) — dependencia nueva,
  requiere APK/dev build nuevo.
- Persistir el archivo en `FileSystem.documentDirectory/recibos/<id>.jpg` y
  guardar la ruta en la columna `foto` (ya reservada).
- Respaldo de la imagen: decisión aparte (local vs **Firebase Storage**). Si se
  quiere respaldo en la nube, se integra Storage; si no, la foto vive solo en el
  teléfono.
- Mostrar la miniatura en la lista/detalle del transporte.

## 9. Alcance por fases

- **Fase 1 (núcleo, esta):** migración v3 + tabla, `db/transportes.ts`, respaldo
  (subida/restore/estado), tarjeta en inicio, pantalla `app/transporte.tsx`
  (formulario + lista con borrar), KPI "Transporte" en Reportes.
- **Fase 2:** foto del recibo (captura + almacenamiento + respaldo) y, si se
  desea, unificar los transportes en el historial general.
