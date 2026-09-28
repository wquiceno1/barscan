import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import BuscadorProducto from '../../components/BuscadorProducto';
import { BarraAgregar, RecuadroEscaner } from '../../components/EscanerActivable';
import { Button, Input } from '../../components/ui';
import { getMargenGeneral } from '../../db/configuracion';
import { getProducto, reactivarProducto } from '../../db/productos';
import { finalizarTransaccion } from '../../db/transacciones';
import type { LineaBorrador, Producto, TipoTransaccion } from '../../db/types';
import { formatCOP, precioConMargen } from '../../db/util';
import { toast } from '../../lib/feedback';
import { colors, font, radius, shadow, spacing } from '../../theme/tokens';

const TITULOS: Record<TipoTransaccion, string> = {
  venta: 'Nueva venta',
  compra: 'Nueva compra',
  ajuste: 'Ajuste de inventario',
};
const ACCENTO: Record<TipoTransaccion, string> = {
  venta: colors.venta,
  compra: colors.compra,
  ajuste: colors.ajuste,
};

function esTipo(v: string): v is TipoTransaccion {
  return v === 'venta' || v === 'compra' || v === 'ajuste';
}

export default function TransaccionScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const params = useLocalSearchParams<{ tipo: string }>();
  const tipo: TipoTransaccion = esTipo(params.tipo) ? params.tipo : 'venta';

  const [lineas, setLineas] = useState<LineaBorrador[]>([]);
  const [contraparte, setContraparte] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [buscadorVisible, setBuscadorVisible] = useState(false);
  // Oculto por defecto: la cámara solo se monta al activarla.
  const [escanerActivo, setEscanerActivo] = useState(false);
  const [margenGeneral, setMargenGeneral] = useState<number | null>(null);
  // Confirmación al finalizar una compra si algún costo supera el precio de venta
  // (síntoma típico de invertir cantidad y costo). Guarda las líneas a persistir.
  const [alertaCosto, setAlertaCosto] = useState<{
    lineas: LineaBorrador[];
    costosos: LineaBorrador[];
  } | null>(null);

  useEffect(() => {
    getMargenGeneral(db).then(setMargenGeneral);
  }, [db]);

  // Si una línea de compra se agregó antes de que cargara el margen general,
  // su precio sugerido pudo calcularse con 0% de margen (ver cambiarCosto/
  // agregarProducto). Apenas el margen general llega, se recalcula esa línea.
  useEffect(() => {
    if (margenGeneral == null || tipo !== 'compra') return;
    setLineas((prev) =>
      prev.map((l) =>
        l.margen_pct_snapshot == null && l.costo_snapshot != null
          ? {
              ...l,
              precio_venta_snapshot: precioConMargen(
                l.costo_snapshot,
                margenGeneral
              ),
            }
          : l
      )
    );
  }, [margenGeneral, tipo]);
  // Texto crudo del input de cantidad mientras se escribe (permite vaciar el
  // campo o, en 'ajuste', estados intermedios como "-" sin perderlos). Override
  // efímero del número.
  const [cantTexto, setCantTexto] = useState<Record<string, string>>({});
  // Resaltado temporal del último producto agregado/incrementado.
  const [resaltado, setResaltado] = useState<string | null>(null);
  const resaltarTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resaltar = useCallback((barcode: string) => {
    setResaltado(barcode);
    if (resaltarTimer.current) clearTimeout(resaltarTimer.current);
    resaltarTimer.current = setTimeout(() => setResaltado(null), 2500);
  }, []);

  useEffect(
    () => () => {
      if (resaltarTimer.current) clearTimeout(resaltarTimer.current);
    },
    []
  );

  const total = lineas.reduce(
    (acc, l) => acc + l.cantidad * l.precio_unitario_snapshot,
    0
  );

  // Agrega/incrementa la línea de un producto (compartido por escaneo y buscador).
  const agregarProducto = useCallback(
    (prod: Producto) => {
      // En compra se precarga el costo guardado; si el producto aún no tiene
      // costo (caso típico en carga inicial con precio fijo), se parte del
      // precio de venta como referencia editable para no dejar el campo vacío.
      const costoCompra = prod.costo ?? prod.precio;
      const precioUnit =
        tipo === 'venta'
          ? prod.precio
          : tipo === 'compra'
            ? costoCompra
            : 0;
      const costoSnap = tipo === 'compra' ? costoCompra : prod.costo;
      const precioVentaSugerido =
        tipo === 'compra'
          ? precioConMargen(costoCompra, prod.margen_pct ?? margenGeneral ?? 0)
          : undefined;

      // En venta no se puede agregar más unidades de las que hay en stock.
      if (tipo === 'venta') {
        const enLinea =
          lineas.find((l) => l.barcode === prod.barcode)?.cantidad ?? 0;
        if (enLinea + 1 > prod.stock_actual) {
          toast(
            prod.stock_actual <= 0
              ? 'Sin stock disponible'
              : `Stock máximo: ${prod.stock_actual}`
          );
          return;
        }
      }

      resaltar(prod.barcode);

      // El número manda: al escanear se descarta el override de texto.
      setCantTexto((t) => {
        const copia = { ...t };
        delete copia[prod.barcode];
        return copia;
      });

      setLineas((prev) => {
        const idx = prev.findIndex((l) => l.barcode === prod.barcode);
        if (idx >= 0) {
          // Defensa: en venta no exceder el stock disponible.
          if (
            tipo === 'venta' &&
            prev[idx].cantidad + 1 > (prev[idx].stock_actual ?? 0)
          ) {
            return prev;
          }
          const copia = [...prev];
          copia[idx] = { ...copia[idx], cantidad: copia[idx].cantidad + 1 };
          return copia;
        }
        // El producto recién agregado va arriba para no tener que hacer scroll.
        return [
          {
            barcode: prod.barcode,
            nombre: prod.nombre,
            // En ajuste se arranca en 0 (delta a escribir); en venta/compra en 1.
            cantidad: tipo === 'ajuste' ? 0 : 1,
            costo_snapshot: costoSnap,
            precio_unitario_snapshot: precioUnit,
            stock_actual: prod.stock_actual,
            margen_pct_snapshot: prod.margen_pct,
            precio_venta_snapshot: precioVentaSugerido,
          },
          ...prev,
        ];
      });
    },
    [tipo, lineas, resaltar, margenGeneral]
  );

  const agregarPorCodigo = useCallback(
    async (code: string) => {
      const prod = await getProducto(db, code);
      if (!prod) {
        Alert.alert(
          'Producto no encontrado',
          `El código ${code} no está en el catálogo.`,
          [
            { text: 'Cancelar', style: 'cancel' },
            {
              text: 'Crear producto',
              onPress: () => router.push(`/producto/nuevo?barcode=${code}`),
            },
          ]
        );
        return;
      }
      if (prod.activo === 0) {
        Alert.alert(
          'Producto inactivo',
          `${prod.nombre} está desactivado y oculto del catálogo. ¿Querés reactivarlo?`,
          [
            { text: 'Cancelar', style: 'cancel' },
            {
              text: 'Reactivar',
              onPress: async () => {
                await reactivarProducto(db, prod.barcode);
                agregarProducto({ ...prod, activo: 1 });
              },
            },
          ]
        );
        return;
      }
      agregarProducto(prod);
    },
    [db, router, agregarProducto]
  );

  const cambiarCantidad = (barcode: string, delta: number) => {
    limpiarTexto(barcode);
    setLineas((prev) =>
      prev
        .map((l) => {
          if (l.barcode !== barcode) return l;
          let cantidad = l.cantidad + delta;
          // En venta, la cantidad no puede superar el stock disponible.
          if (tipo === 'venta' && cantidad > (l.stock_actual ?? 0)) {
            cantidad = l.stock_actual ?? 0;
          }
          return { ...l, cantidad };
        })
        .filter((l) => l.cantidad !== 0)
    );
  };

  // Compra y venta: edición directa de la cantidad, para no tener que pulsar +
  // muchas veces al ingresar grandes cantidades. Se guarda el texto crudo
  // mientras se escribe (permite vaciar el campo) y el número se recupera al
  // salir del foco. En venta rige el mismo tope de stock que en el botón +:
  // si se escribe de más, se lleva al máximo disponible y se avisa.
  const editarCantidad = (barcode: string, texto: string) => {
    const limpio = texto.replace(/[^\d]/g, '');
    let n = limpio === '' ? 0 : parseInt(limpio, 10) || 0;
    const stock = lineas.find((l) => l.barcode === barcode)?.stock_actual ?? 0;
    const excede = tipo === 'venta' && n > stock;
    if (excede) {
      n = stock;
      toast(`Stock máximo: ${stock}`);
    }
    setCantTexto((t) => ({ ...t, [barcode]: excede ? String(n) : limpio }));
    setLineas((prev) =>
      prev.map((l) => (l.barcode === barcode ? { ...l, cantidad: n } : l))
    );
  };

  const limpiarTexto = (barcode: string) =>
    setCantTexto((t) => {
      const copia = { ...t };
      delete copia[barcode];
      return copia;
    });

  // Ajuste: −/+ no eliminan la línea al llegar a 0 (0 es un delta válido en
  // construcción; la línea se quita solo con la papelera o al finalizar).
  const cambiarCantidadAjuste = (barcode: string, delta: number) => {
    limpiarTexto(barcode);
    setLineas((prev) =>
      prev.map((l) =>
        l.barcode === barcode ? { ...l, cantidad: l.cantidad + delta } : l
      )
    );
  };

  // Ajuste: edición directa del delta, admitiendo un signo negativo inicial.
  const cambiarCantidadTexto = (barcode: string, texto: string) => {
    let limpio = texto.replace(/[^\d-]/g, '');
    const negativo = limpio.startsWith('-');
    limpio = limpio.replace(/-/g, '');
    if (negativo) limpio = '-' + limpio;
    setCantTexto((t) => ({ ...t, [barcode]: limpio }));
    const n = limpio === '' || limpio === '-' ? 0 : parseInt(limpio, 10) || 0;
    setLineas((prev) =>
      prev.map((l) => (l.barcode === barcode ? { ...l, cantidad: n } : l))
    );
  };

  // Ajuste: invierte el signo (vía garantizada para negativos en Android).
  const invertirSigno = (barcode: string) => {
    limpiarTexto(barcode);
    setLineas((prev) =>
      prev.map((l) =>
        l.barcode === barcode ? { ...l, cantidad: -l.cantidad } : l
      )
    );
  };

  const quitarLinea = (barcode: string) => {
    limpiarTexto(barcode);
    setLineas((prev) => prev.filter((l) => l.barcode !== barcode));
  };

  // En compras: editar el costo unitario que cobró el proveedor. El precio de
  // venta sugerido se recalcula en vivo con el margen del producto (o el
  // general si no tiene uno propio).
  const cambiarCosto = (barcode: string, texto: string) => {
    const n = Number(texto.replace(/[^\d]/g, '')) || 0;
    setLineas((prev) =>
      prev.map((l) =>
        l.barcode === barcode
          ? {
              ...l,
              precio_unitario_snapshot: n,
              costo_snapshot: n,
              precio_venta_snapshot: precioConMargen(
                n,
                l.margen_pct_snapshot ?? margenGeneral ?? 0
              ),
            }
          : l
      )
    );
  };

  // En compras: redondear/ajustar a mano el precio de venta sugerido.
  const cambiarPrecioVenta = (barcode: string, texto: string) => {
    const n = Number(texto.replace(/[^\d]/g, '')) || 0;
    setLineas((prev) =>
      prev.map((l) =>
        l.barcode === barcode ? { ...l, precio_venta_snapshot: n } : l
      )
    );
  };

  // Persiste la transacción. Se llama tras pasar las validaciones (o tras
  // confirmar el aviso de costo).
  const guardar = async (lineasValidas: LineaBorrador[]) => {
    setGuardando(true);
    try {
      await finalizarTransaccion(db, {
        tipo,
        cliente_proveedor: contraparte.trim() || null,
        motivo: tipo === 'ajuste' ? contraparte.trim() || null : null,
        lineas: lineasValidas,
      });
      toast(TITULOS[tipo] + ' guardada');
      router.back();
    } catch (e) {
      setGuardando(false);
      Alert.alert('Error', String(e));
    }
  };

  const finalizar = () => {
    // En ajuste se ignoran las líneas con delta 0; en venta/compra se descartan
    // las de cantidad 0 (p. ej. si se vació el campo editable de cantidad).
    const lineasValidas =
      tipo === 'ajuste'
        ? lineas.filter((l) => l.cantidad !== 0)
        : lineas.filter((l) => l.cantidad > 0);
    if (lineasValidas.length === 0) {
      Alert.alert(
        'Sin cambios',
        tipo === 'ajuste'
          ? 'No hay ajustes que guardar.'
          : 'Agrega al menos un producto.'
      );
      return;
    }
    if (tipo === 'compra') {
      const sinPrecio = lineasValidas.find(
        (l) => !l.precio_venta_snapshot || l.precio_venta_snapshot <= 0
      );
      if (sinPrecio) {
        Alert.alert(
          'Precio inválido',
          `"${sinPrecio.nombre}" no tiene un precio de venta válido. Revisá el campo "Precio sugerido" antes de finalizar.`
        );
        return;
      }
      // Aviso: costo por unidad mayor que el precio de venta (probable error de
      // tipeo, como invertir cantidad y costo). Se confirma antes de guardar.
      const costosos = lineasValidas.filter(
        (l) =>
          l.precio_venta_snapshot != null &&
          l.precio_venta_snapshot > 0 &&
          l.precio_unitario_snapshot > l.precio_venta_snapshot
      );
      if (costosos.length > 0) {
        setAlertaCosto({ lineas: lineasValidas, costosos });
        return;
      }
    }
    guardar(lineasValidas);
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior="padding">
      <Stack.Screen options={{ title: TITULOS[tipo] }} />

      <RecuadroEscaner
        activo={escanerActivo}
        altura={220}
        hint="Apunta al código de barras"
        onScan={agregarPorCodigo}
        paused={guardando || buscadorVisible}
      />

      <BarraAgregar
        onBuscar={() => setBuscadorVisible(true)}
        escanerActivo={escanerActivo}
        onToggleEscaner={() => setEscanerActivo((v) => !v)}
      />

      <BuscadorProducto
        visible={buscadorVisible}
        onClose={() => setBuscadorVisible(false)}
        onSelect={agregarProducto}
      />

      <FlatList
        style={styles.lista}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
        data={lineas}
        keyExtractor={(l) => l.barcode}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons
              name="barcode-outline"
              size={40}
              color={colors.textMuted}
            />
            <Text style={styles.emptyText}>
              Busca un producto o activa el escáner para agregarlo.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          if (tipo === 'ajuste') {
            const stockActual = item.stock_actual ?? 0;
            const resultante = stockActual + item.cantidad;
            const display =
              cantTexto[item.barcode] !== undefined
                ? cantTexto[item.barcode]
                : String(item.cantidad);
            return (
              <View
                style={[
                  styles.linea,
                  item.barcode === resaltado && styles.lineaResaltada,
                ]}
              >
                <View style={styles.lineaHeader}>
                  <Text style={[styles.lineaNombre, styles.flex1]}>
                    {item.nombre}
                  </Text>
                  <Pressable onPress={() => quitarLinea(item.barcode)} hitSlop={8}>
                    <Ionicons
                      name="trash-outline"
                      size={20}
                      color={colors.textMuted}
                    />
                  </Pressable>
                </View>
                <Text style={styles.stockActual}>
                  Stock actual: <Text style={styles.stockActualNum}>{stockActual}</Text>
                </Text>
                <View style={styles.ajusteControls}>
                  <Pressable
                    style={styles.qtyBtn}
                    onPress={() => cambiarCantidadAjuste(item.barcode, -1)}
                  >
                    <Ionicons name="remove" size={18} color={colors.text} />
                  </Pressable>
                  <TextInput
                    style={styles.ajusteInput}
                    keyboardType="numeric"
                    selectTextOnFocus
                    value={display}
                    onChangeText={(t) => cambiarCantidadTexto(item.barcode, t)}
                    placeholder="0"
                    placeholderTextColor={colors.textMuted}
                  />
                  <Pressable
                    style={styles.qtyBtn}
                    onPress={() => cambiarCantidadAjuste(item.barcode, 1)}
                  >
                    <Ionicons name="add" size={18} color={colors.text} />
                  </Pressable>
                  <Pressable
                    style={styles.signBtn}
                    onPress={() => invertirSigno(item.barcode)}
                  >
                    <Text style={styles.signBtnText}>±</Text>
                  </Pressable>
                </View>
                <Text
                  style={[
                    styles.resultante,
                    resultante < 0 && styles.resultanteWarn,
                  ]}
                >
                  Stock resultante:{' '}
                  <Text
                    style={[
                      styles.resultanteNum,
                      resultante < 0 && styles.resultanteWarn,
                    ]}
                  >
                    {resultante}
                  </Text>
                </Text>
              </View>
            );
          }
          const topeVenta =
            tipo === 'venta' && item.cantidad >= (item.stock_actual ?? 0);
          return (
          <View
            style={[
              styles.linea,
              item.barcode === resaltado && styles.lineaResaltada,
            ]}
          >
            <Text style={styles.lineaNombre}>{item.nombre}</Text>
            {tipo === 'venta' && (
              <Text
                style={[styles.stockHint, topeVenta && styles.stockHintWarn]}
              >
                Stock disponible: {item.stock_actual ?? 0}
              </Text>
            )}
            <View style={styles.lineaMain}>
              <View style={styles.col}>
                <Text style={styles.colLabel}>
                  {tipo === 'compra' ? 'Costo c/u' : 'Precio c/u'}
                </Text>
                {tipo === 'compra' ? (
                  <>
                    <TextInput
                      style={styles.costoInput}
                      keyboardType="numeric"
                      selectTextOnFocus
                      value={
                        item.precio_unitario_snapshot
                          ? String(item.precio_unitario_snapshot)
                          : ''
                      }
                      onChangeText={(texto) => cambiarCosto(item.barcode, texto)}
                      placeholder="0"
                      placeholderTextColor={colors.textMuted}
                    />
                    <Text style={styles.refVentaLabel}>Precio sugerido</Text>
                    <TextInput
                      style={styles.precioVentaInput}
                      keyboardType="numeric"
                      selectTextOnFocus
                      value={
                        item.precio_venta_snapshot
                          ? String(item.precio_venta_snapshot)
                          : ''
                      }
                      onChangeText={(texto) =>
                        cambiarPrecioVenta(item.barcode, texto)
                      }
                      placeholder="0"
                      placeholderTextColor={colors.textMuted}
                    />
                  </>
                ) : (
                  <Text style={styles.colValue}>
                    {formatCOP(item.precio_unitario_snapshot)}
                  </Text>
                )}
              </View>

              <View style={styles.col}>
                <Text style={styles.colLabel}>Cantidad</Text>
                <View style={styles.qtyControls}>
                  <Pressable
                    style={styles.qtyBtn}
                    onPress={() => cambiarCantidad(item.barcode, -1)}
                  >
                    <Ionicons name="remove" size={18} color={colors.text} />
                  </Pressable>
                  <TextInput
                    style={styles.qtyInput}
                    keyboardType="numeric"
                    selectTextOnFocus
                    value={
                      cantTexto[item.barcode] !== undefined
                        ? cantTexto[item.barcode]
                        : String(item.cantidad)
                    }
                    onChangeText={(t) => editarCantidad(item.barcode, t)}
                    onBlur={() => limpiarTexto(item.barcode)}
                    placeholder="0"
                    placeholderTextColor={colors.textMuted}
                  />
                  <Pressable
                    style={[styles.qtyBtn, topeVenta && styles.qtyBtnOff]}
                    disabled={topeVenta}
                    onPress={() => cambiarCantidad(item.barcode, 1)}
                  >
                    <Ionicons
                      name="add"
                      size={18}
                      color={topeVenta ? colors.textMuted : colors.text}
                    />
                  </Pressable>
                </View>
              </View>

              <View style={[styles.col, styles.colRight]}>
                <Text style={styles.colLabel}>Total</Text>
                <Text style={styles.subtotal}>
                  {formatCOP(item.cantidad * item.precio_unitario_snapshot)}
                </Text>
              </View>
            </View>
          </View>
          );
        }}
      />

      <View style={styles.footer}>
        <Input
          placeholder={
            tipo === 'venta'
              ? 'Cliente (opcional)'
              : tipo === 'compra'
                ? 'Proveedor (opcional)'
                : 'Motivo del ajuste (opcional)'
          }
          value={contraparte}
          onChangeText={setContraparte}
        />
        {tipo !== 'ajuste' && (
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={[styles.totalValue, { color: ACCENTO[tipo] }]}>
              {formatCOP(total)}
            </Text>
          </View>
        )}
        <Button
          label="Finalizar"
          icon="checkmark-circle"
          variant={tipo}
          size="lg"
          loading={guardando}
          onPress={finalizar}
        />
      </View>

      <Modal
        visible={alertaCosto != null}
        transparent
        animationType="fade"
        onRequestClose={() => setAlertaCosto(null)}
      >
        <View style={styles.alertaOverlay}>
          <View style={styles.alertaCard}>
            <Text style={styles.alertaTitulo}>⚠ Revisá el costo</Text>
            <Text style={styles.alertaCuerpo}>
              {alertaCosto?.costosos.length === 1
                ? 'En este producto el costo por unidad es mayor que el precio de venta:'
                : 'En estos productos el costo por unidad es mayor que el precio de venta:'}
            </Text>
            {alertaCosto?.costosos.map((l) => (
              <Text key={l.barcode} style={styles.alertaItem}>
                • {l.nombre}: costo {formatCOP(l.precio_unitario_snapshot)} {'>'} venta{' '}
                {formatCOP(l.precio_venta_snapshot ?? 0)}
              </Text>
            ))}
            <Text style={styles.alertaCuerpo}>
              ¿Seguro que querés guardar así? Revisá que no hayas invertido la
              cantidad y el costo.
            </Text>
            <View style={styles.alertaBotones}>
              <Pressable
                style={({ pressed }) => [styles.alertaBtn, pressed && styles.pressed]}
                onPress={() => setAlertaCosto(null)}
              >
                <Text style={styles.alertaBtnRevisar}>Revisar</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.alertaBtn,
                  styles.alertaBtnGuardar,
                  pressed && styles.pressed,
                ]}
                onPress={() => {
                  if (!alertaCosto) return;
                  const ls = alertaCosto.lineas;
                  setAlertaCosto(null);
                  guardar(ls);
                }}
              >
                <Text style={styles.alertaBtnGuardarText}>
                  Guardar de todos modos
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  pressed: { opacity: 0.85 },
  lista: { flex: 1 },
  empty: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.sm },
  emptyText: { color: colors.textMuted, fontSize: font.md },
  linea: {
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    // Borde transparente reservado para que el resaltado no desplace el layout.
    borderWidth: 2,
    borderColor: 'transparent',
    ...shadow,
  },
  lineaResaltada: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '14',
  },
  lineaNombre: { fontSize: font.md, fontWeight: '700', color: colors.text },
  stockHint: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
  stockHintWarn: { color: colors.danger, fontWeight: '700' },
  qtyBtnOff: { opacity: 0.4 },
  flex1: { flex: 1 },
  lineaHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  stockActual: { fontSize: font.sm, color: colors.textMuted },
  stockActualNum: { color: colors.text, fontWeight: '700' },
  ajusteControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  ajusteInput: {
    flex: 1,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    fontSize: font.lg,
    fontWeight: '700',
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
  },
  signBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signBtnText: { fontSize: font.lg, fontWeight: '800', color: colors.text },
  resultante: { fontSize: font.sm, color: colors.textMuted },
  resultanteNum: { color: colors.text, fontWeight: '800' },
  resultanteWarn: { color: colors.danger },
  lineaMain: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  col: { gap: spacing.xs },
  colRight: { alignItems: 'flex-end' },
  colLabel: { fontSize: font.xs, color: colors.textMuted, fontWeight: '600' },
  colValue: { fontSize: font.md, fontWeight: '700', color: colors.text },
  qtyControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  costoInput: {
    width: 100,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    fontSize: font.md,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
  },
  refVentaLabel: {
    fontSize: font.xs,
    color: colors.textMuted,
    marginTop: 6,
  },
  precioVentaInput: {
    width: 100,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    fontSize: font.md,
    color: colors.venta,
    fontWeight: '700',
    backgroundColor: colors.surfaceAlt,
  },
  qtyBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyInput: {
    minWidth: 56,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    fontSize: font.lg,
    fontWeight: '700',
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
  },
  subtotal: {
    minWidth: 84,
    textAlign: 'right',
    fontSize: font.md,
    fontWeight: '800',
    color: colors.text,
  },
  footer: {
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  totalLabel: { fontSize: font.md, color: colors.textMuted, fontWeight: '600' },
  totalValue: { fontSize: font.xxl, fontWeight: '800' },
  alertaOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  alertaCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  alertaTitulo: { fontSize: font.lg, fontWeight: '800', color: colors.danger },
  alertaCuerpo: { fontSize: font.md, color: colors.text },
  alertaItem: { fontSize: font.md, fontWeight: '800', color: colors.danger },
  alertaBotones: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  alertaBtn: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
  },
  alertaBtnRevisar: { fontSize: font.md, fontWeight: '800', color: colors.primary },
  alertaBtnGuardar: { backgroundColor: colors.danger },
  alertaBtnGuardarText: {
    fontSize: font.md,
    fontWeight: '800',
    color: colors.textInverse,
  },
});
