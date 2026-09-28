import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import {
  FlatList,
  Keyboard,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import ScannerView from '../../components/ScannerView';
import SugerenciasHistorial, {
  type SeleccionHistorial,
} from '../../components/SugerenciasHistorial';
import { EmptyState, Input, Screen } from '../../components/ui';
import { getProducto } from '../../db/productos';
import { etiquetaSalida } from '../../db/salidas';
import {
  listarTransacciones,
  type FiltroHistorial,
} from '../../db/transacciones';
import type { TipoTransaccion, Transaccion } from '../../db/types';
import { formatCOP } from '../../db/util';
import {
  dateADiaStr,
  diaADate,
  fechaLarga,
  hoyMesStr,
  hoyStr,
  mesLargo,
  rangoDia,
  rangoMes,
  sumarDias,
  sumarMeses,
} from '../../lib/fecha';
import { colors, font, radius, shadow, spacing } from '../../theme/tokens';

type Alcance = 'dia' | 'mes' | 'todo';
const ALCANCES: { key: Alcance; label: string }[] = [
  { key: 'dia', label: 'Día' },
  { key: 'mes', label: 'Mes' },
  { key: 'todo', label: 'Todo' },
];

const TIPOS: (TipoTransaccion | 'todos')[] = ['todos', 'venta', 'compra', 'ajuste'];
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

/** Cómo filtra el historial cada tipo de selección del buscador. */
function filtroDeSeleccion(s: SeleccionHistorial | null): FiltroHistorial {
  if (!s) return {};
  switch (s.por) {
    case 'texto':
      return { producto: s.texto };
    case 'producto':
      return { barcode: s.barcode };
    case 'contraparte':
      return {
        contraparte: {
          nombres: s.contraparte.nombres,
          tipo: s.contraparte.tipo,
        },
      };
  }
}

/** Ícono y texto con que se muestra la selección en el campo de búsqueda. */
function vistaDeSeleccion(s: SeleccionHistorial): {
  icono: keyof typeof Ionicons.glyphMap;
  texto: string;
} {
  switch (s.por) {
    case 'texto':
      return { icono: 'search', texto: `Contiene «${s.texto}»` };
    case 'producto':
      return { icono: 'cube-outline', texto: s.nombre };
    case 'contraparte':
      return s.contraparte.tipo === 'venta'
        ? { icono: 'person-outline', texto: `${s.contraparte.nombre} · cliente` }
        : {
            icono: 'storefront-outline',
            texto: `${s.contraparte.nombre} · proveedor`,
          };
  }
}

/** Texto con el que se reabre el buscador cuando ya hay una búsqueda activa. */
function textoDeSeleccion(s: SeleccionHistorial | null): string {
  if (!s) return '';
  if (s.por === 'texto') return s.texto;
  if (s.por === 'producto') return s.nombre;
  return s.contraparte.nombre;
}

export default function HistorialScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [filtro, setFiltro] = useState<TipoTransaccion | 'todos'>('todos');
  const [alcance, setAlcance] = useState<Alcance>('dia');
  const [dia, setDia] = useState(hoyStr());
  const [mes, setMes] = useState(hoyMesStr());
  const [mostrarPicker, setMostrarPicker] = useState(false);
  const [seleccion, setSeleccion] = useState<SeleccionHistorial | null>(null);
  // Texto del campo mientras se busca. Con `editando`, en lugar de la lista de
  // operaciones se muestran las sugerencias, en esta misma pantalla.
  const [busqueda, setBusqueda] = useState('');
  const [editando, setEditando] = useState(false);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [alcanceVisible, setAlcanceVisible] = useState(false);
  const [items, setItems] = useState<Transaccion[]>([]);

  const esHoy = dia === hoyStr();
  const esMesActual = mes === hoyMesStr();
  // El selector de alcance solo importa cuando estás buscando. Es "pegajoso":
  // aparece al empezar a buscar o al escanear, y queda visible (aunque toques
  // un chip) hasta que cierres la búsqueda con la X.
  const mostrarAlcance = alcanceVisible || editando || seleccion != null;

  // Tocar el campo muestra las sugerencias, con el texto de la búsqueda activa.
  const empezarBusqueda = () => {
    setBusqueda(textoDeSeleccion(seleccion));
    setEditando(true);
    setAlcanceVisible(true);
  };

  const elegir = (s: SeleccionHistorial) => {
    Keyboard.dismiss();
    setSeleccion(s);
    setEditando(false);
  };

  // "Buscar" en el teclado sin elegir una sugerencia = todo lo que contenga.
  const buscarTexto = () => {
    const texto = busqueda.trim();
    if (texto) elegir({ por: 'texto', texto });
  };

  const cerrarBusqueda = () => {
    Keyboard.dismiss();
    setSeleccion(null);
    setBusqueda('');
    setEditando(false);
    setAlcanceVisible(false);
  };
  const totalPeriodo =
    filtro === 'venta' || filtro === 'compra'
      ? items.reduce((acc, t) => acc + t.total, 0)
      : 0;

  // Rango según el alcance elegido: día, mes o toda la historia (sin fecha).
  const rango =
    alcance === 'dia'
      ? rangoDia(dia)
      : alcance === 'mes'
        ? rangoMes(mes)
        : null;

  // Recarga al cambiar alcance/período/tipo/búsqueda y al volver a la pantalla.
  useFocusEffect(
    useCallback(() => {
      listarTransacciones(db, {
        ...(rango ?? {}),
        ...(filtro === 'todos' ? {} : { tipo: filtro }),
        ...filtroDeSeleccion(seleccion),
      }).then(setItems);
      // rango es derivado de alcance/dia/mes; se listan esas fuentes.
    }, [db, filtro, alcance, dia, mes, seleccion])
  );

  // Escanear elige el producto directamente. El nombre es solo para mostrar:
  // el filtro va por código, así que un código que ya no está en el catálogo
  // igual encuentra su historial.
  const buscarPorCodigo = async (code: string) => {
    setScannerVisible(false);
    setAlcanceVisible(true);
    const prod = await getProducto(db, code);
    elegir({ por: 'producto', barcode: code, nombre: prod?.nombre ?? code });
  };

  const vista = seleccion ? vistaDeSeleccion(seleccion) : null;

  // Mientras se buscan sugerencias no se ve la navegación de fechas: esta línea
  // dice a qué período apunta el alcance elegido.
  const detalleAlcance =
    alcance === 'dia'
      ? esHoy
        ? 'Operaciones de hoy'
        : `Operaciones del ${fechaLarga(dia)}`
      : alcance === 'mes'
        ? `Operaciones de ${mesLargo(mes)}`
        : 'Todo el historial';

  return (
    <Screen padded>
      <View style={styles.searchRow}>
        {editando ? (
          <View style={styles.searchInput}>
            <Input
              placeholder="Producto, cliente o proveedor…"
              value={busqueda}
              onChangeText={setBusqueda}
              autoFocus
              selectTextOnFocus
              returnKeyType="search"
              onSubmitEditing={buscarTexto}
            />
          </View>
        ) : (
          <Pressable
            onPress={empezarBusqueda}
            style={({ pressed }) => [styles.campo, pressed && styles.pressed]}
          >
            <Ionicons
              name={vista?.icono ?? 'search'}
              size={18}
              color={vista ? colors.primary : colors.textMuted}
            />
            <Text
              style={[styles.campoTexto, !vista && styles.campoPlaceholder]}
              numberOfLines={1}
            >
              {vista?.texto ?? 'Buscar producto, cliente o proveedor…'}
            </Text>
          </Pressable>
        )}
        {mostrarAlcance && (
          <Pressable
            onPress={cerrarBusqueda}
            hitSlop={8}
            style={({ pressed }) => [styles.clearBtn, pressed && styles.pressed]}
          >
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </Pressable>
        )}
        <Pressable
          onPress={() => setScannerVisible(true)}
          style={({ pressed }) => [styles.scanButton, pressed && styles.pressed]}
        >
          <Ionicons name="scan-outline" size={22} color={colors.textInverse} />
        </Pressable>
      </View>

      <Modal
        visible={scannerVisible}
        animationType="slide"
        onRequestClose={() => setScannerVisible(false)}
      >
        <View style={styles.scannerModal}>
          <ScannerView onScan={buscarPorCodigo} />
          <View style={styles.scanHint}>
            <Ionicons name="scan-outline" size={16} color={colors.textInverse} />
            <Text style={styles.scanHintText}>Apunta al código de barras</Text>
          </View>
          <Pressable
            onPress={() => setScannerVisible(false)}
            style={({ pressed }) => [styles.scanClose, pressed && styles.pressed]}
          >
            <Ionicons name="close" size={26} color={colors.textInverse} />
          </Pressable>
        </View>
      </Modal>

      {mostrarAlcance && (
        <View style={styles.alcanceRow}>
          {ALCANCES.map(({ key, label }) => {
            const on = alcance === key;
            return (
              <Pressable
                key={key}
                onPress={() => setAlcance(key)}
                style={[styles.alcanceChip, on && styles.alcanceChipOn]}
              >
                <Text
                  style={[styles.alcanceText, on && styles.alcanceTextOn]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {editando ? (
        <>
          <Text style={styles.detalleAlcance}>{detalleAlcance}</Text>
          <SugerenciasHistorial busqueda={busqueda} onElegir={elegir} />
        </>
      ) : (
        <>
          {alcance === 'dia' && (
            <>
              <View style={styles.diaNav}>
                <Pressable
                  onPress={() => setDia((x) => sumarDias(x, -1))}
                  hitSlop={8}
                  style={styles.navBtn}
                >
                  <Ionicons name="chevron-back" size={22} color={colors.text} />
                </Pressable>
                <Pressable
                  onPress={() => setMostrarPicker(true)}
                  style={styles.diaFechaBtn}
                >
                  <Ionicons name="calendar-outline" size={16} color={colors.primary} />
                  <Text style={styles.diaFecha}>
                    {esHoy ? 'Hoy' : fechaLarga(dia)}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setDia((x) => sumarDias(x, 1))}
                  disabled={esHoy}
                  hitSlop={8}
                  style={[styles.navBtn, esHoy && styles.navBtnOff]}
                >
                  <Ionicons name="chevron-forward" size={22} color={colors.text} />
                </Pressable>
              </View>
              {!esHoy && (
                <Pressable onPress={() => setDia(hoyStr())} style={styles.hoyBtn}>
                  <Ionicons name="today-outline" size={14} color={colors.primary} />
                  <Text style={styles.hoyBtnText}>Volver a hoy</Text>
                </Pressable>
              )}
              {mostrarPicker && (
                <DateTimePicker
                  value={diaADate(dia)}
                  mode="date"
                  maximumDate={new Date()}
                  onChange={(event, selected) => {
                    setMostrarPicker(false);
                    if (event.type === 'set' && selected) {
                      setDia(dateADiaStr(selected));
                    }
                  }}
                />
              )}
            </>
          )}

          {alcance === 'mes' && (
            <>
              <View style={styles.diaNav}>
                <Pressable
                  onPress={() => setMes((x) => sumarMeses(x, -1))}
                  hitSlop={8}
                  style={styles.navBtn}
                >
                  <Ionicons name="chevron-back" size={22} color={colors.text} />
                </Pressable>
                <View style={styles.diaFechaBtn}>
                  <Ionicons name="calendar-outline" size={16} color={colors.primary} />
                  <Text style={styles.diaFecha}>{mesLargo(mes)}</Text>
                </View>
                <Pressable
                  onPress={() => setMes((x) => sumarMeses(x, 1))}
                  disabled={esMesActual}
                  hitSlop={8}
                  style={[styles.navBtn, esMesActual && styles.navBtnOff]}
                >
                  <Ionicons name="chevron-forward" size={22} color={colors.text} />
                </Pressable>
              </View>
              {!esMesActual && (
                <Pressable
                  onPress={() => setMes(hoyMesStr())}
                  style={styles.hoyBtn}
                >
                  <Ionicons name="today-outline" size={14} color={colors.primary} />
                  <Text style={styles.hoyBtnText}>Volver a este mes</Text>
                </Pressable>
              )}
            </>
          )}

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

          {(filtro === 'venta' || filtro === 'compra') && (
            <View
              style={[
                styles.totalBar,
                filtro === 'compra' && styles.totalBarCompra,
              ]}
            >
              <Text style={styles.totalBarLabel}>
                {`Total ${filtro === 'venta' ? 'ventas' : 'compras'} ${
                  alcance === 'dia' ? 'del día' : alcance === 'mes' ? 'del mes' : 'histórico'
                }`}
              </Text>
              <Text
                style={[
                  styles.totalBarValue,
                  filtro === 'compra' && styles.totalBarValueCompra,
                ]}
              >
                {formatCOP(totalPeriodo)}
              </Text>
            </View>
          )}

          <FlatList
            data={items}
            keyExtractor={(t) => t.id}
            contentContainerStyle={{ gap: spacing.sm }}
            ListEmptyComponent={
              <EmptyState
                icon="time-outline"
                title={
                  seleccion?.por === 'contraparte'
                    ? `Sin operaciones de ${seleccion.contraparte.nombre}`
                    : seleccion
                      ? 'Sin resultados para ese producto'
                      : 'Sin operaciones en el período'
                }
                subtitle={
                  seleccion?.por === 'contraparte'
                    ? `No hay ${seleccion.contraparte.tipo === 'venta' ? 'ventas' : 'compras'} a su nombre en este período. Probá ampliar el alcance a Mes o Todo.`
                    : seleccion
                      ? 'Ninguna operación de este período incluye ese producto. Probá ampliar el alcance a Mes o Todo.'
                      : 'Las ventas, compras y ajustes del período elegido aparecerán aquí.'
                }
              />
            }
            renderItem={({ item }) => {
              const salida = etiquetaSalida(item.categoria, item.subcategoria);
              const badgeColor = salida ? colors.salida : COLOR[item.tipo];
              const icono = salida ? 'exit' : ICONO[item.tipo];
              const etiqueta = salida ?? ETIQUETA[item.tipo];
              const mostrarTotal = item.tipo !== 'ajuste' || salida != null;
              return (
                <Pressable
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                  onPress={() => router.push(`/detalle/${item.id}`)}
                >
                  <View style={[styles.badge, { backgroundColor: badgeColor }]}>
                    <Ionicons name={icono} size={18} color={colors.textInverse} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.tipo}>
                      {etiqueta}
                      {item.cliente_proveedor ? ` · ${item.cliente_proveedor}` : ''}
                    </Text>
                    <Text style={styles.fecha}>{item.fecha_hora.slice(11, 16)}</Text>
                  </View>
                  {mostrarTotal && (
                    <Text style={styles.total}>{formatCOP(item.total)}</Text>
                  )}
                </Pressable>
              );
            }}
          />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  searchInput: { flex: 1 },
  // Muestra la búsqueda activa (o el placeholder); al tocarlo aparece el campo
  // de texto con las sugerencias.
  campo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  campoTexto: { flex: 1, fontSize: font.md, color: colors.text },
  campoPlaceholder: { color: colors.textMuted },
  clearBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanButton: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scannerModal: { flex: 1, backgroundColor: '#000' },
  scanHint: {
    position: 'absolute',
    bottom: spacing.xl,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
  },
  scanHintText: {
    color: colors.textInverse,
    fontSize: font.sm,
    fontWeight: '600',
  },
  scanClose: {
    position: 'absolute',
    top: spacing.xl,
    right: spacing.lg,
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  alcanceRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  alcanceChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  alcanceChipOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  alcanceText: { fontSize: font.sm, fontWeight: '700', color: colors.textMuted },
  alcanceTextOn: { color: colors.textInverse },
  detalleAlcance: {
    fontSize: font.xs,
    color: colors.textMuted,
    marginTop: -spacing.xs,
    marginBottom: spacing.sm,
  },
  diaNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  navBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBtnOff: { opacity: 0.35 },
  diaFechaBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  diaFecha: {
    fontSize: font.md,
    fontWeight: '800',
    color: colors.text,
    textTransform: 'capitalize',
  },
  hoyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  hoyBtnText: { fontSize: font.sm, color: colors.primary, fontWeight: '700' },
  filtros: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  totalBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.venta + '14',
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  totalBarCompra: { backgroundColor: colors.compra + '14' },
  totalBarLabel: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  totalBarValue: { fontSize: font.lg, fontWeight: '800', color: colors.venta },
  totalBarValueCompra: { color: colors.compra },
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
