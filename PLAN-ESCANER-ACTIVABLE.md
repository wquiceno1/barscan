# Plan: Escáner activable en las operaciones

Estado: **implementado y validado en el dispositivo** (2026-09-28, Expo Go SDK 54).
Documento de trabajo con las decisiones del 2026-09-28.

## 1. Objetivo

En la operación diaria el escáner casi no se usa, pero ocupa un recuadro fijo de
200–220 px arriba de la lista en las pantallas de operación. No se retira: pasa a
ser **activable**. Arranca oculto, se activa con un botón en la fila del buscador,
y la lista de productos agregados ocupa el espacio que se libera.

## 2. Decisiones acordadas

| Tema | Decisión |
|------|----------|
| Estado inicial | **Oculto** cada vez que se entra a la pantalla. No se recuerda la última elección. |
| Cámara oculta | **Desmontada** (apagada), no solo escondida con estilos. |
| Botón | En la **fila del buscador**, con el mismo patrón que Historial y Catálogo: `[Buscar producto] [📷]`. |
| Escáner activo | **Mismo tamaño, misma posición y mismo funcionamiento** que antes: lectura continua, pausa entre lecturas y pausa mientras el buscador está abierto. |
| Alcance | Solo las pantallas donde el escáner estaba fijo (ver §3). |

## 3. Alcance

| Pantalla | ¿Cambia? |
|----------|----------|
| Venta / Compra / Ajuste — `app/transaccion/[tipo].tsx` | **Sí** (recuadro de 220 px) |
| Salida sin venta — `app/salida.tsx` | **Sí** (200 px) |
| Cambio / Devolución — `app/cambio.tsx` | **Sí** (200 px) |
| Historial, Catálogo, Ficha de producto | No: ya abren el escáner a pedido, en un modal |
| Carga inicial | No: ahí la cámara **es** la pantalla |

## 4. Por qué desmontar y no esconder

- La doc de `expo-camera` (SDK 54) dice: *"Only one Camera preview can be active
  at any given time. If you have multiple screens in your app, you should unmount
  `Camera` components whenever a screen is unfocused."*
- La prop `active`, que apaga la sesión sin desmontar, es **solo iOS**. En
  Android, esconder el recuadro con estilos deja la cámara encendida: gasta
  batería, calienta el teléfono y sigue procesando cuadros.
- Costo: cada vez que se activa, la cámara tarda un momento en arrancar.
  `ScannerView` ya soporta montajes limpios (es lo que hace al volver de otra
  pantalla).

## 5. Diseño técnico

Nuevo `components/EscanerActivable.tsx` con dos componentes presentacionales. El
estado (`escanerActivo`) vive en cada pantalla, para que cada una los ubique donde
estaban: en Cambio / Devolución, el selector Devuelve/Lleva queda entre la cámara
y la fila de búsqueda, como antes.

- **`RecuadroEscaner`** — `{ activo, altura, hint, onScan, paused }`. Si `activo`
  es `false` devuelve `null` y la cámara no se monta. Si es `true` dibuja el mismo
  recuadro negro con `ScannerView` y el texto de ayuda de siempre.
- **`BarraAgregar`** — `{ onBuscar, escanerActivo, onToggleEscaner }`. Fila con
  "Buscar producto por nombre" (abre `BuscadorProducto`) y el botón de escanear
  de 44×44, como el de Historial. Con el escáner activo, el botón muestra el
  ícono de cerrar.

`ScannerView` no cambia. La lista ya tiene `flex: 1`, así que ocupa sola el
espacio liberado.

**Textos:**
- "Agregar sin escanear (granel / por nombre)" pasa a "Buscar producto por
  nombre": con el escáner oculto por defecto, buscar deja de ser la alternativa.
- Los textos de lista vacía ahora mencionan las dos formas de agregar, por
  ejemplo "Busca un producto o activa el escáner para agregarlo.". Cambio /
  Devolución conserva el voseo que ya usaba.

Sin migración ni dependencias nuevas, pero para llegar al celular hace falta un
APK nuevo (el proyecto no tiene actualizaciones remotas).

## 6. Pruebas en el dispositivo

- [ ] Al entrar a venta, compra, ajuste, salida y cambio no hay cámara, y la lista
      arranca justo debajo de la fila del buscador.
- [ ] Tocar 📷 muestra la cámara en el mismo lugar y del mismo tamaño que antes;
      escanear agrega igual que antes.
- [ ] Tocar de nuevo la oculta y **la cámara se apaga**: en Android 12+ se apaga
      el punto verde de cámara en uso.
- [ ] Con la cámara activa, abrir el buscador pausa las lecturas, como antes.
- [ ] Al salir y volver a entrar, la cámara arranca oculta.
- [ ] Sin permiso de cámara: al activarla, el pedido de permiso aparece dentro
      del recuadro.
- [ ] En Cambio / Devolución, el texto de ayuda sigue mostrando Devuelve o Lleva
      según el modo.
