import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import BuscadorProducto from '../components/BuscadorProducto';
import ScannerView from '../components/ScannerView';
import { Button } from '../components/ui';
import { getProducto } from '../db/productos';
import { registrarCambio } from '../db/transacciones';
import type { LineaBorrador, Producto } from '../db/types';
import { formatCOP } from '../db/util';
import { toast } from '../lib/feedback';
import { colors, font, radius, shadow, spacing } from '../theme/tokens';

type Bucket = 'devuelve' | 'lleva';

export default function CambioScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [modo, setModo] = useState<Bucket>('devuelve');
  const [devuelve, setDevuelve] = useState<LineaBorrador[]>([]);
  const [lleva, setLleva] = useState<LineaBorrador[]>([]);
  const [buscadorVisible, setBuscadorVisible] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const setBucket = modo === 'devuelve' ? setDevuelve : setLleva;

  const agregar = useCallback(
    (prod: Producto) => {
      if (modo === 'lleva') {
        const enLinea =
          lleva.find((l) => l.barcode === prod.barcode)?.cantidad ?? 0;
        if (enLinea + 1 > prod.stock_actual) {
          toast(
            prod.stock_actual <= 0
              ? 'Sin stock disponible'
              : `Stock máximo: ${prod.stock_actual}`
          );
          return;
        }
      }
      setBucket((prev) => {
        const idx = prev.findIndex((l) => l.barcode === prod.barcode);
        if (idx >= 0) {
          if (
            modo === 'lleva' &&
            prev[idx].cantidad + 1 > (prev[idx].stock_actual ?? 0)
          ) {
            return prev;
          }
          const copia = [...prev];
          copia[idx] = { ...copia[idx], cantidad: copia[idx].cantidad + 1 };
          return copia;
        }
        return [
          {
            barcode: prod.barcode,
            nombre: prod.nombre,
            cantidad: 1,
            costo_snapshot: prod.costo,
            precio_unitario_snapshot: prod.precio,
            stock_actual: prod.stock_actual,
          },
          ...prev,
        ];
      });
    },
    [modo, lleva, setBucket]
  );

  const agregarPorCodigo = useCallback(
    async (code: string) => {
      const prod = await getProducto(db, code);
      if (!prod) {
        toast(`Código ${code} no está en el catálogo`);
        return;
      }
      agregar(prod);
    },
    [db, agregar]
  );

  const cambiarCant = (bucket: Bucket, barcode: string, delta: number) => {
    const set = bucket === 'devuelve' ? setDevuelve : setLleva;
    set((prev) =>
      prev
        .map((l) => {
          if (l.barcode !== barcode) return l;
          let cantidad = l.cantidad + delta;
          if (bucket === 'lleva' && cantidad > (l.stock_actual ?? 0)) {
            cantidad = l.stock_actual ?? 0;
          }
          return { ...l, cantidad };
        })
        .filter((l) => l.cantidad > 0)
    );
  };

  // Precio de reembolso editable en la pata "devuelve" (default: precio actual).
  const cambiarReembolso = (barcode: string, texto: string) => {
    const n = Number(texto.replace(/[^\d]/g, '')) || 0;
    setDevuelve((prev) =>
      prev.map((l) =>
        l.barcode === barcode ? { ...l, precio_unitario_snapshot: n } : l
      )
    );
  };

  const quitar = (bucket: Bucket, barcode: string) => {
    const set = bucket === 'devuelve' ? setDevuelve : setLleva;
    set((prev) => prev.filter((l) => l.barcode !== barcode));
  };

  const totalDevuelve = devuelve.reduce(
    (a, l) => a + l.cantidad * l.precio_unitario_snapshot,
    0
  );
  const totalLleva = lleva.reduce(
    (a, l) => a + l.cantidad * l.precio_unitario_snapshot,
    0
  );
  const neto = totalLleva - totalDevuelve; // < 0 reembolsar, > 0 cobrar

  const confirmar = async () => {
    const dev = devuelve.filter((l) => l.cantidad > 0);
    if (dev.length === 0) {
      Alert.alert(
        'Sin devolución',
        'Agregá al menos un producto que el cliente devuelve.'
      );
      return;
    }
    const llv = lleva.filter((l) => l.cantidad > 0);
    setGuardando(true);
    try {
      await registrarCambio(db, { devuelve: dev, lleva: llv });
      const msg =
        neto < 0
          ? `Devolvé ${formatCOP(-neto)}`
          : neto > 0
            ? `Cobrá ${formatCOP(neto)}`
            : 'Cambio parejo';
      toast(`Cambio registrado · ${msg}`);
      router.back();
    } catch (e) {
      setGuardando(false);
      Alert.alert('Error', String(e));
    }
  };

  const netoLabel =
    neto < 0
      ? `Devolver al cliente: ${formatCOP(-neto)}`
      : neto > 0
        ? `Cobrar al cliente: ${formatCOP(neto)}`
        : 'Cambio parejo';

  const renderLinea = (bucket: Bucket, item: LineaBorrador) => {
    const esDev = bucket === 'devuelve';
    const topeVenta =
      bucket === 'lleva' && item.cantidad >= (item.stock_actual ?? 0);
    return (
      <View key={item.barcode} style={styles.linea}>
        <View style={styles.lineaHeader}>
          <Text style={styles.lineaNombre}>{item.nombre}</Text>
          <Pressable onPress={() => quitar(bucket, item.barcode)} hitSlop={8}>
            <Ionicons name="trash-outline" size={20} color={colors.textMuted} />
          </Pressable>
        </View>
        {!esDev && (
          <Text style={[styles.stockHint, topeVenta && styles.stockHintWarn]}>
            Stock disponible: {item.stock_actual ?? 0}
          </Text>
        )}
        <View style={styles.lineaMain}>
          <View style={styles.col}>
            <Text style={styles.colLabel}>
              {esDev ? 'Reembolso c/u' : 'Precio c/u'}
            </Text>
            {esDev ? (
              <TextInput
                style={styles.precioInput}
                keyboardType="numeric"
                selectTextOnFocus
                value={
                  item.precio_unitario_snapshot
                    ? String(item.precio_unitario_snapshot)
                    : ''
                }
                onChangeText={(t) => cambiarReembolso(item.barcode, t)}
                placeholder="0"
                placeholderTextColor={colors.textMuted}
              />
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
                onPress={() => cambiarCant(bucket, item.barcode, -1)}
              >
                <Ionicons name="remove" size={18} color={colors.text} />
              </Pressable>
              <Text style={styles.qty}>{item.cantidad}</Text>
              <Pressable
                style={[styles.qtyBtn, topeVenta && styles.qtyBtnOff]}
                disabled={topeVenta}
                onPress={() => cambiarCant(bucket, item.barcode, 1)}
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
            <Text style={styles.colLabel}>Subtotal</Text>
            <Text style={[styles.subtotal, esDev && styles.subtotalDev]}>
              {esDev ? '−' : ''}
              {formatCOP(item.cantidad * item.precio_unitario_snapshot)}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior="padding">
      <Stack.Screen options={{ title: 'Cambio / Devolución' }} />

      <View style={styles.scanner}>
        <ScannerView
          onScan={agregarPorCodigo}
          paused={guardando || buscadorVisible}
        />
        <View style={styles.scanHint}>
          <Ionicons name="scan-outline" size={16} color={colors.textInverse} />
          <Text style={styles.scanHintText}>
            Escaneá y se agrega a “{modo === 'devuelve' ? 'Devuelve' : 'Lleva'}”
          </Text>
        </View>
      </View>

      <View style={styles.toggle}>
        <Pressable
          onPress={() => setModo('devuelve')}
          style={[styles.tab, modo === 'devuelve' && styles.tabDev]}
        >
          <Ionicons
            name="arrow-undo"
            size={16}
            color={modo === 'devuelve' ? colors.textInverse : colors.textMuted}
          />
          <Text
            style={[styles.tabText, modo === 'devuelve' && styles.tabTextOn]}
          >
            Devuelve
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setModo('lleva')}
          style={[styles.tab, modo === 'lleva' && styles.tabLleva]}
        >
          <Ionicons
            name="cart"
            size={16}
            color={modo === 'lleva' ? colors.textInverse : colors.textMuted}
          />
          <Text style={[styles.tabText, modo === 'lleva' && styles.tabTextOn]}>
            Lleva
          </Text>
        </Pressable>
      </View>

      <Pressable
        onPress={() => setBuscadorVisible(true)}
        style={({ pressed }) => [styles.sinEscanear, pressed && styles.pressed]}
      >
        <Ionicons name="search" size={18} color={colors.primary} />
        <Text style={styles.sinEscanearText}>
          Agregar sin escanear (granel / por nombre)
        </Text>
      </Pressable>

      <BuscadorProducto
        visible={buscadorVisible}
        onClose={() => setBuscadorVisible(false)}
        onSelect={agregar}
      />

      <ScrollView
        style={styles.lista}
        contentContainerStyle={styles.listaContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.section, { color: colors.salida }]}>
          Devuelve (entra al stock)
        </Text>
        {devuelve.length === 0 ? (
          <Text style={styles.vacio}>Escaneá lo que el cliente devuelve.</Text>
        ) : (
          devuelve.map((l) => renderLinea('devuelve', l))
        )}

        <Text style={[styles.section, { color: colors.venta }]}>
          Lleva (sale del stock) · opcional
        </Text>
        {lleva.length === 0 ? (
          <Text style={styles.vacio}>
            Si el cliente se lleva otra cosa, agregala acá.
          </Text>
        ) : (
          lleva.map((l) => renderLinea('lleva', l))
        )}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.netoRow}>
          <Text style={styles.netoLabel}>{netoLabel}</Text>
          <Text
            style={[
              styles.netoValue,
              { color: neto < 0 ? colors.danger : colors.venta },
            ]}
          >
            {neto === 0 ? '—' : formatCOP(Math.abs(neto))}
          </Text>
        </View>
        <Button
          label="Registrar cambio"
          icon="swap-horizontal"
          variant="primary"
          size="lg"
          loading={guardando}
          onPress={confirmar}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  pressed: { opacity: 0.85 },
  scanner: { height: 200, backgroundColor: '#000' },
  scanHint: {
    position: 'absolute',
    bottom: spacing.md,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.overlay,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
  },
  scanHintText: { color: colors.textInverse, fontSize: font.xs },
  toggle: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.sm,
    backgroundColor: colors.surface,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabDev: { backgroundColor: colors.salida, borderColor: colors.salida },
  tabLleva: { backgroundColor: colors.venta, borderColor: colors.venta },
  tabText: { fontSize: font.md, fontWeight: '800', color: colors.textMuted },
  tabTextOn: { color: colors.textInverse },
  sinEscanear: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sinEscanearText: {
    color: colors.primary,
    fontSize: font.md,
    fontWeight: '700',
  },
  lista: { flex: 1 },
  listaContent: { padding: spacing.lg, gap: spacing.sm },
  section: {
    fontSize: font.xs,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.sm,
  },
  vacio: { fontSize: font.sm, color: colors.textMuted },
  linea: {
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    ...shadow,
  },
  lineaHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  lineaNombre: { flex: 1, fontSize: font.md, fontWeight: '700', color: colors.text },
  stockHint: { fontSize: font.xs, color: colors.textMuted },
  stockHintWarn: { color: colors.danger, fontWeight: '700' },
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
  precioInput: {
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
  qtyControls: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
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
  qtyBtnOff: { opacity: 0.4 },
  qty: { minWidth: 28, textAlign: 'center', fontSize: font.lg, fontWeight: '700' },
  subtotal: {
    minWidth: 84,
    textAlign: 'right',
    fontSize: font.md,
    fontWeight: '800',
    color: colors.text,
  },
  subtotalDev: { color: colors.danger },
  footer: {
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  netoRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  netoLabel: { flex: 1, fontSize: font.md, color: colors.text, fontWeight: '700' },
  netoValue: { fontSize: font.xxl, fontWeight: '800' },
});
