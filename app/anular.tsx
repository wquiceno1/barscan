import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Card, EmptyState, Input, Screen } from '../components/ui';
import { etiquetaSalida } from '../db/salidas';
import {
  anularTransaccion,
  getTransaccion,
  listarTransacciones,
} from '../db/transacciones';
import type { TipoTransaccion, Transaccion } from '../db/types';
import { formatCOP } from '../db/util';
import { usuarioActual } from '../lib/auth';
import { estadoRespaldo } from '../lib/backup';
import { toast } from '../lib/feedback';
import { colors, font, radius, shadow, spacing } from '../theme/tokens';

// Sin búsqueda la lista sería el historial entero; con este tope alcanza para
// encontrar un error reciente, que es el caso real de uso.
const TOPE = 150;

const TIPOS: (TipoTransaccion | 'todos')[] = [
  'todos',
  'venta',
  'compra',
  'ajuste',
];
const ETIQUETA: Record<TipoTransaccion, string> = {
  venta: 'Venta',
  compra: 'Compra',
  ajuste: 'Ajuste',
};
const ICONO: Record<TipoTransaccion, keyof typeof Ionicons.glyphMap> = {
  venta: 'cart',
  compra: 'cube',
  ajuste: 'construct',
};
const COLOR: Record<TipoTransaccion, string> = {
  venta: colors.venta,
  compra: colors.compra,
  ajuste: colors.ajuste,
};

/** ISO local 'YYYY-MM-DDTHH:mm:ss' a 'DD/MM/YYYY HH:mm'. */
function fechaCorta(iso: string): string {
  const [dia, hora] = iso.split('T');
  const [a, m, d] = dia.split('-');
  return `${d}/${m}/${a} ${(hora ?? '').slice(0, 5)}`;
}

export default function AnularScreen() {
  const db = useSQLiteContext();
  const [filtro, setFiltro] = useState<TipoTransaccion | 'todos'>('todos');
  const [producto, setProducto] = useState('');
  const [items, setItems] = useState<Transaccion[]>([]);
  const [pendientes, setPendientes] = useState(0);
  const [anulando, setAnulando] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    const filas = await listarTransacciones(db, {
      limite: TOPE,
      ...(filtro === 'todos' ? {} : { tipo: filtro }),
      ...(producto.trim() ? { producto } : {}),
    });
    setItems(filas);
    if (usuarioActual()) {
      setPendientes((await estadoRespaldo(db)).pendientes);
    }
  }, [db, filtro, producto]);

  useFocusEffect(
    useCallback(() => {
      recargar();
    }, [recargar])
  );

  const anular = async (id: string) => {
    setAnulando(id);
    try {
      const r = await anularTransaccion(db, id);
      await recargar();
      toast(
        `${ETIQUETA[r.tipo]} anulada · stock revertido en ${r.productos} producto(s)`
      );
      if (!usuarioActual()) {
        Alert.alert(
          'Falta borrarlo del respaldo',
          'No tienes sesión iniciada, así que la operación sigue en la nube. ' +
            'Inicia sesión en Ajustes y respalda para que el borrado también llegue allí.'
        );
      }
    } catch (e) {
      Alert.alert(
        'No se pudo anular',
        (e as Error)?.message ?? 'Error desconocido.'
      );
    } finally {
      setAnulando(null);
    }
  };

  // El detalle completo se lee al tocar la fila: la confirmación tiene que
  // mostrar qué productos se van a devolver al stock, no solo el total.
  const confirmar = async (tx: Transaccion) => {
    const detalle = await getTransaccion(db, tx.id);
    if (!detalle) {
      toast('La operación ya no existe');
      recargar();
      return;
    }
    const lineas = detalle.items;
    const visibles = lineas
      .slice(0, 6)
      .map((l) => `• ${l.nombre_snapshot} ×${l.cantidad}`)
      .join('\n');
    const resto =
      lineas.length > 6 ? `\n• …y ${lineas.length - 6} producto(s) más` : '';
    const productos = new Set(lineas.map((l) => l.barcode)).size;
    const etiqueta =
      etiquetaSalida(tx.categoria, tx.subcategoria) ?? ETIQUETA[tx.tipo];

    Alert.alert(
      '¿Anular esta operación?',
      `${etiqueta} · ${fechaCorta(tx.fecha_hora)}\n` +
        (tx.cliente_proveedor ? `${tx.cliente_proveedor}\n` : '') +
        `\n${visibles}${resto}\n\n` +
        `Total: ${formatCOP(tx.total)}\n\n` +
        `Se devolverá el stock de ${productos} producto(s) a como estaba y la ` +
        'operación desaparecerá del historial y de los reportes. No se puede deshacer.' +
        (tx.tipo === 'compra'
          ? '\n\nOjo: el costo y el precio de venta que fijó esta compra NO vuelven al valor anterior; revísalos a mano si hace falta.'
          : ''),
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Anular', style: 'destructive', onPress: () => anular(tx.id) },
      ]
    );
  };

  return (
    <Screen padded>
      <Card style={styles.aviso}>
        <View style={styles.avisoHead}>
          <Ionicons name="warning-outline" size={18} color={colors.danger} />
          <Text style={styles.avisoTitle}>Borra el movimiento de verdad</Text>
        </View>
        <Text style={styles.help}>
          Úsalo solo para errores de registro: una compra que no ocurrió, una
          venta cargada dos veces. Devuelve el stock a como estaba y borra la
          operación aquí y en el respaldo de la nube.
        </Text>
      </Card>

      <View style={styles.buscador}>
        <Input
          placeholder="Buscar por producto…"
          value={producto}
          onChangeText={setProducto}
        />
      </View>

      <View style={styles.filtros}>
        {TIPOS.map((t) => {
          const on = filtro === t;
          return (
            <Pressable
              key={t}
              onPress={() => setFiltro(t)}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>
                {t === 'todos' ? 'Todos' : ETIQUETA[t]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {usuarioActual() && pendientes > 0 && (
        <Text style={styles.pendientes}>
          {pendientes} cambio(s) pendiente(s) de subir al respaldo.
        </Text>
      )}

      <FlatList
        data={items}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ gap: spacing.sm }}
        ListEmptyComponent={
          <EmptyState
            icon="search-outline"
            title="Sin operaciones"
            subtitle={
              producto.trim()
                ? 'Ninguna operación reciente incluye ese producto.'
                : 'Aquí aparecen las últimas operaciones registradas.'
            }
          />
        }
        renderItem={({ item }) => {
          const salida = etiquetaSalida(item.categoria, item.subcategoria);
          const badgeColor = salida ? colors.salida : COLOR[item.tipo];
          const etiqueta = salida ?? ETIQUETA[item.tipo];
          const ocupado = anulando === item.id;
          return (
            <Pressable
              disabled={ocupado}
              style={({ pressed }) => [
                styles.row,
                (pressed || ocupado) && styles.pressed,
              ]}
              onPress={() => confirmar(item)}
            >
              <View style={[styles.badge, { backgroundColor: badgeColor }]}>
                <Ionicons
                  name={salida ? 'exit' : ICONO[item.tipo]}
                  size={18}
                  color={colors.textInverse}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.tipo}>
                  {etiqueta}
                  {item.cliente_proveedor ? ` · ${item.cliente_proveedor}` : ''}
                </Text>
                <Text style={styles.fecha}>{fechaCorta(item.fecha_hora)}</Text>
              </View>
              {(item.tipo !== 'ajuste' || salida != null) && (
                <Text style={styles.total}>{formatCOP(item.total)}</Text>
              )}
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  aviso: { marginBottom: spacing.md, gap: spacing.sm },
  avisoHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avisoTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  help: { fontSize: font.sm, color: colors.textMuted },
  buscador: { marginBottom: spacing.sm },
  filtros: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textMuted, fontWeight: '700', fontSize: font.sm },
  chipTextOn: { color: colors.textInverse },
  pendientes: {
    fontSize: font.xs,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  pressed: { opacity: 0.85 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    ...shadow,
  },
  badge: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tipo: { fontSize: font.md, fontWeight: '700', color: colors.text },
  fecha: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
  total: { fontSize: font.md, fontWeight: '800', color: colors.text },
});
