import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import BuscadorProducto from '../components/BuscadorProducto';
import { BarraAgregar, RecuadroEscaner } from '../components/EscanerActivable';
import { Button, Input } from '../components/ui';
import { getProducto, reactivarProducto } from '../db/productos';
import {
  CATEGORIAS_SALIDA,
  LABEL_CATEGORIA,
  LABEL_SUBCAT,
  SUBCATS_DEDUCCION,
  type CategoriaSalida,
  type SubcatDeduccion,
} from '../db/salidas';
import { finalizarTransaccion } from '../db/transacciones';
import type { LineaBorrador, Producto } from '../db/types';
import { formatCOP } from '../db/util';
import { toast } from '../lib/feedback';
import { colors, font, radius, shadow, spacing } from '../theme/tokens';

export default function SalidaScreen() {
  const db = useSQLiteContext();
  const router = useRouter();

  const [categoria, setCategoria] = useState<CategoriaSalida>('colegio');
  const [subcategoria, setSubcategoria] = useState<SubcatDeduccion>('aseo');
  const [lineas, setLineas] = useState<LineaBorrador[]>([]);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [buscadorVisible, setBuscadorVisible] = useState(false);
  // Oculto por defecto: la cámara solo se monta al activarla.
  const [escanerActivo, setEscanerActivo] = useState(false);
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

  // Agrega/incrementa la línea de un producto (no se puede sacar más de lo que
  // hay en stock, igual que en una venta).
  const agregarProducto = useCallback(
    (prod: Producto) => {
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
      resaltar(prod.barcode);
      setLineas((prev) => {
        const idx = prev.findIndex((l) => l.barcode === prod.barcode);
        if (idx >= 0) {
          if (prev[idx].cantidad + 1 > (prev[idx].stock_actual ?? 0)) return prev;
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
    [lineas, resaltar]
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
    setLineas((prev) =>
      prev
        .map((l) => {
          if (l.barcode !== barcode) return l;
          let cantidad = l.cantidad + delta;
          if (cantidad > (l.stock_actual ?? 0)) cantidad = l.stock_actual ?? 0;
          return { ...l, cantidad };
        })
        .filter((l) => l.cantidad !== 0)
    );
  };

  const finalizar = async () => {
    if (lineas.length === 0) {
      Alert.alert('Sin productos', 'Agrega al menos un producto.');
      return;
    }
    setGuardando(true);
    try {
      await finalizarTransaccion(db, {
        tipo: 'ajuste',
        categoria,
        subcategoria: categoria === 'deduccion' ? subcategoria : null,
        motivo: nota.trim() || null,
        lineas,
      });
      toast('Salida registrada');
      router.back();
    } catch (e) {
      setGuardando(false);
      Alert.alert('Error', String(e));
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior="padding">
      <Stack.Screen options={{ title: 'Salida sin venta' }} />

      {/* Selector de categoría */}
      <View style={styles.selector}>
        <View style={styles.segmentRow}>
          {CATEGORIAS_SALIDA.map((c) => {
            const on = categoria === c;
            return (
              <Pressable
                key={c}
                onPress={() => setCategoria(c)}
                style={[styles.segment, on && styles.segmentOn]}
              >
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  style={[styles.segmentText, on && styles.segmentTextOn]}
                >
                  {LABEL_CATEGORIA[c]}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {categoria === 'deduccion' && (
          <View style={styles.subcatRow}>
            {SUBCATS_DEDUCCION.map((s) => {
              const on = subcategoria === s;
              return (
                <Pressable
                  key={s}
                  onPress={() => setSubcategoria(s)}
                  style={[styles.subcatChip, on && styles.subcatChipOn]}
                >
                  <Text
                    numberOfLines={1}
                    style={[styles.subcatText, on && styles.subcatTextOn]}
                  >
                    {LABEL_SUBCAT[s]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      <RecuadroEscaner
        activo={escanerActivo}
        altura={200}
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
            <Ionicons name="barcode-outline" size={40} color={colors.textMuted} />
            <Text style={styles.emptyText}>
              Busca un producto o activa el escáner para registrar la salida.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const tope = item.cantidad >= (item.stock_actual ?? 0);
          return (
            <View
              style={[
                styles.linea,
                item.barcode === resaltado && styles.lineaResaltada,
              ]}
            >
              <Text style={styles.lineaNombre}>{item.nombre}</Text>
              <Text style={[styles.stockHint, tope && styles.stockHintWarn]}>
                Stock disponible: {item.stock_actual ?? 0}
              </Text>
              <View style={styles.lineaMain}>
                <View style={styles.col}>
                  <Text style={styles.colLabel}>Precio c/u</Text>
                  <Text style={styles.colValue}>
                    {formatCOP(item.precio_unitario_snapshot)}
                  </Text>
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
                    <Text style={styles.qty}>{item.cantidad}</Text>
                    <Pressable
                      style={[styles.qtyBtn, tope && styles.qtyBtnOff]}
                      disabled={tope}
                      onPress={() => cambiarCantidad(item.barcode, 1)}
                    >
                      <Ionicons
                        name="add"
                        size={18}
                        color={tope ? colors.textMuted : colors.text}
                      />
                    </Pressable>
                  </View>
                </View>
                <View style={[styles.col, styles.colRight]}>
                  <Text style={styles.colLabel}>Valor</Text>
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
          placeholder="Nota (opcional)"
          value={nota}
          onChangeText={setNota}
        />
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Valor de la salida</Text>
          <Text style={styles.totalValue}>{formatCOP(total)}</Text>
        </View>
        <Button
          label="Registrar salida"
          icon="checkmark-circle"
          variant="salida"
          size="lg"
          loading={guardando}
          onPress={finalizar}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  selector: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  segmentRow: { flexDirection: 'row', gap: spacing.sm },
  segment: {
    flex: 1,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segmentOn: { backgroundColor: colors.salida, borderColor: colors.salida },
  segmentText: {
    fontSize: font.md,
    lineHeight: 20,
    fontWeight: '700',
    textAlign: 'center',
    includeFontPadding: false,
    color: colors.textMuted,
  },
  segmentTextOn: { color: colors.textInverse },
  subcatRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  subcatChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  subcatChipOn: {
    backgroundColor: colors.salida + '1a',
    borderColor: colors.salida,
  },
  subcatText: {
    fontSize: font.sm,
    fontWeight: '600',
    includeFontPadding: false,
    color: colors.textMuted,
  },
  subcatTextOn: { color: colors.salida, fontWeight: '800' },
  lista: { flex: 1 },
  empty: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.sm },
  emptyText: { color: colors.textMuted, fontSize: font.md, textAlign: 'center' },
  linea: {
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 2,
    borderColor: 'transparent',
    ...shadow,
  },
  lineaResaltada: {
    borderColor: colors.salida,
    backgroundColor: colors.salida + '14',
  },
  lineaNombre: { fontSize: font.md, fontWeight: '700', color: colors.text },
  stockHint: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
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
  totalValue: { fontSize: font.xxl, fontWeight: '800', color: colors.salida },
});
