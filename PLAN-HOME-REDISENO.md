# Plan: Rediseño del home (jerarquía de acciones)

Estado: **implementado 2026-08-04, falta probar en runtime**. Documento de trabajo
acordado con el dueño (Tienda Comunal de la Vereda Santa Barbara).

## 1. Objetivo

Darle **protagonismo a "Nueva venta"** (la acción más usada a diario) y reducir la
confusión **venta ↔ compra**, que hoy obliga a rehacer la operación. Hoy las 5-6
tarjetas se apilan iguales, a lo ancho, y "Nueva venta" no destaca.

## 2. Diseño propuesto

**"Nueva venta" como tarjeta hero** (grande, arriba, a todo el ancho) y el resto como
**tiles compactos en grilla de 2 por fila** (sin descripción, para achicarlas).

```
┌──────────────────────────────────────┐
│                                      │
│   🛒   NUEVA VENTA                    │   ← hero: grande, verde, protagonista
│                                      │
└──────────────────────────────────────┘
┌─────────────────┐  ┌─────────────────┐
│      📦          │  │      🔧          │
│    Compra        │  │    Ajuste        │
└─────────────────┘  └─────────────────┘
┌─────────────────┐  ┌─────────────────┐
│      ↩          │  │      🚌          │
│    Salida        │  │   Transporte     │
└─────────────────┘  └─────────────────┘
┌─────────────────┐
│      🔁          │
│    Cambio        │   ← tile de devoluciones (ver PLAN-DEVOLUCIONES.md)
└─────────────────┘
```

- **Hero (Nueva venta):** ícono grande + etiqueta grande (verde `colors.venta`), a
  todo el ancho, con sombra/realce. Es lo primero y lo más visible.
- **Tiles (compra, ajuste, salida, transporte, cambio):** ícono en círculo + etiqueta
  corta, **sin descripción**, ~48% de ancho (2 por fila). El color propio de cada
  acción se conserva — con la venta grande y verde arriba, y compra como tile azul
  chico, la confusión venta/compra desaparece.
- **Etiquetas cortas** en los tiles: "Compra", "Ajuste", "Salida", "Transporte",
  "Cambio".

> Alternativa: **3 por fila** (tiles más chicos). Recomiendo **2** por mejor área de
> toque y porque son solo 5 acciones secundarias; se decide al implementar.

## 3. Cambios de código

Todo en [app/(tabs)/index.tsx](app/(tabs)/index.tsx) (+ tokens si hace falta):

- Separar el actual `Accion` (fila con ícono + descripción + chevron) en **dos**:
  - **`AccionHero`** — grande, a todo el ancho: ícono ~32 en círculo ~64, etiqueta
    `font.xxl`, sin descripción.
  - **`AccionTile`** — compacto: ícono ~24 en círculo ~48 arriba, etiqueta centrada
    debajo, **sin descripción ni chevron**.
- **Layout:** hero arriba; debajo, contenedor `flexDirection:'row'`, `flexWrap:'wrap'`,
  `gap`, con cada tile en `width:'48%'` (2 por fila; el último queda a media fila,
  alineado a la izquierda — comportamiento natural del wrap).
- Quitar el campo `desc` del render (o dejarlo solo en el hero si se quiere un
  subtítulo — por ahora **sin descripción** en todos).
- Reordenar: **venta (hero)** → compra → ajuste → salida → transporte → **cambio**.
- Reusar `colors`, `spacing`, `radius`, `shadow`; sin dependencias nuevas.

## 4. Alcance y notas

- **Fase única:** solo el home (`index.tsx`). No toca navegación, rutas ni lógica
  de las operaciones — cada tarjeta sigue haciendo `router.push(...)` a su pantalla.
- **Se integra con** [PLAN-DEVOLUCIONES.md](PLAN-DEVOLUCIONES.md): el tile "Cambio"
  es la tarjeta nueva de ese plan; conviene implementar ambos juntos (o el home
  después, dejando el tile listo).
- **Fuera de alcance:** cambiar íconos/paleta de marca o el resto de las tabs.
