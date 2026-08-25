import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Card, EmptyState, Screen } from '../components/ui';
import {
  productosSinVentas,
  productosVendidos,
  type FilaSinVenta,
  type FilaVenta,
  type MetricaVenta,
  type OrdenVentas,
} from '../db/reportes';
import { formatCOP } from '../db/util';
import {
  diaADate,
  hoyMesStr,
  hoySemanaStr,
  mesLargo,
  rangoMes,
  rangoSemana,
  semanaLarga,
  sumarMeses,
  sumarSemanas,
} from '../lib/fecha';
import { colors, font, radius, shadow, spacing } from '../theme/tokens';

// Las listas arrancan cortas: el interés está en la cabeza (o en la cola, al
// invertir el orden), no en recorrer cientos de productos.
const TOPE_INICIAL = 20;

type Vista = 'vendidos' | 'sin-ventas';
const VISTAS: { key: Vista; label: string }[] = [
  { key: 'vendidos', label: 'Vendidos' },
  { key: 'sin-ventas', label: 'Sin ventas' },
];

type Alcance = 'semana' | 'mes' | 'todo';
const ALCANCES: { key: Alcance; label: string }[] = [
  { key: 'semana', label: 'Semana' },
  { key: 'mes', label: 'Mes' },
  { key: 'todo', label: 'Todo' },
];

const METRICAS: { key: MetricaVenta; label: string }[] = [
  { key: 'unidades', label: 'Unidades' },
  { key: 'total', label: 'Valor' },
];

/** "Nunca vendido" / "Hace 12 días" a partir de la fecha de la última venta. */
function desdeUltimaVenta(iso: string | null): string {
  if (!iso) return 'Nunca vendido';
  const dias = Math.floor(
    (Date.now() - diaADate(iso.slice(0, 10)).getTime()) / 86_400_000
  );
  if (dias <= 0) return 'Vendido hoy';
  if (dias === 1) return 'Hace 1 día';
  if (dias < 30) return `Hace ${dias} días`;
  const meses = Math.floor(dias / 30);
  return meses === 1 ? 'Hace 1 mes' : `Hace ${meses} meses`;
}

export default function VentasPorProductoScreen() {
  const db = useSQLiteContext();
  const [vista, setVista] = useState<Vista>('vendidos');
  const [alcance, setAlcance] = useState<Alcance>('mes');
  const [semana, setSemana] = useState(hoySemanaStr());
  const [mes, setMes] = useState(hoyMesStr());
  const [metrica, setMetrica] = useState<MetricaVenta>('unidades');
  const [direccion, setDireccion] = useState<OrdenVentas['direccion']>('desc');
  const [vendidos, setVendidos] = useState<FilaVenta[]>([]);
  const [sinVentas, setSinVentas] = useState<FilaSinVenta[]>([]);
  const [inmovilizado, setInmovilizado] = useState(0);
  const [expandido, setExpandido] = useState(false);

  const esSemanaActual = semana === hoySemanaStr();
  const esMesActual = mes === hoyMesStr();

  const rango =
    alcance === 'semana'
      ? rangoSemana(semana)
      : alcance === 'mes'
        ? rangoMes(mes)
        : undefined;

  // Dos efectos separados: el orden solo afecta al ranking, así que cambiarlo
  // no debe rehacer la consulta de los que no se vendieron.
  useFocusEffect(
    useCallback(() => {
      productosVendidos(db, rango, { metrica, direccion }).then((r) => {
        setVendidos(r.filas);
      });
      // `rango` es derivado de alcance/semana/mes; se listan esas fuentes.
    }, [db, alcance, semana, mes, metrica, direccion])
  );

  useFocusEffect(
    useCallback(() => {
      productosSinVentas(db, rango).then((r) => {
        setSinVentas(r.filas);
        setInmovilizado(r.valorInmovilizado);
      });
    }, [db, alcance, semana, mes])
  );

  const nuncaVendidos = sinVentas.filter((f) => f.ultima_venta === null).length;

  const enVendidos = vista === 'vendidos';
  const datos: (FilaVenta | FilaSinVenta)[] = enVendidos ? vendidos : sinVentas;
  const visibles = expandido ? datos : datos.slice(0, TOPE_INICIAL);
  const ocultos = datos.length - visibles.length;

  const retroceder = () =>
    alcance === 'semana'
      ? setSemana((s) => sumarSemanas(s, -1))
      : setMes((m) => sumarMeses(m, -1));
  const avanzar = () =>
    alcance === 'semana'
      ? setSemana((s) => sumarSemanas(s, 1))
      : setMes((m) => sumarMeses(m, 1));
  const enElPresente = alcance === 'semana' ? esSemanaActual : esMesActual;

  return (
    <Screen padded>
      <View style={styles.tabs}>
        {VISTAS.map(({ key, label }) => {
          const on = vista === key;
          return (
            <Pressable
              key={key}
              onPress={() => {
                setVista(key);
                setExpandido(false);
              }}
              style={[styles.tab, on && styles.tabOn]}
            >
              <Text style={[styles.tabText, on && styles.tabTextOn]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.chips}>
        {ALCANCES.map(({ key, label }) => {
          const on = alcance === key;
          return (
            <Pressable
              key={key}
              onPress={() => setAlcance(key)}
              style={[styles.chip, styles.chipFlex, on && styles.chipOn]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {alcance !== 'todo' && (
        <View style={styles.nav}>
          <Pressable onPress={retroceder} hitSlop={8} style={styles.navBtn}>
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.periodo}>
            {alcance === 'semana' ? semanaLarga(semana) : mesLargo(mes)}
          </Text>
          <Pressable
            onPress={avanzar}
            disabled={enElPresente}
            hitSlop={8}
            style={[styles.navBtn, enElPresente && styles.navBtnOff]}
          >
            <Ionicons name="chevron-forward" size={22} color={colors.text} />
          </Pressable>
        </View>
      )}

      {!enVendidos && (
        <Card style={styles.resumen}>
          <Columna valor={String(sinVentas.length)} label="sin vender" />
          <Separador />
          <Columna valor={formatCOP(inmovilizado)} label="en estante" />
          <Separador />
          <Columna valor={String(nuncaVendidos)} label="nunca vendidos" />
        </Card>
      )}

      {enVendidos ? (
        <View style={styles.ordenRow}>
          <View style={styles.chips}>
            {METRICAS.map(({ key, label }) => {
              const on = metrica === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => setMetrica(key)}
                  style={[styles.chip, on && styles.chipOn]}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            onPress={() => setDireccion((d) => (d === 'desc' ? 'asc' : 'desc'))}
            style={({ pressed }) => [styles.dirBtn, pressed && styles.pressed]}
          >
            <Ionicons
              name={direccion === 'desc' ? 'arrow-down' : 'arrow-up'}
              size={16}
              color={colors.primary}
            />
            <Text style={styles.dirText}>
              {direccion === 'desc' ? 'Más vendidos' : 'Menos vendidos'}
            </Text>
          </Pressable>
        </View>
      ) : (
        <Text style={styles.nota}>
          Productos activos sin una sola venta en el período, con la plata que
          tienen quieta en el estante. Ordenados de mayor a menor valor detenido.
        </Text>
      )}

      <FlatList
        data={visibles}
        keyExtractor={(f) => f.barcode}
        contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.xl }}
        ListEmptyComponent={
          <EmptyState
            icon={enVendidos ? 'bar-chart-outline' : 'checkmark-circle-outline'}
            title={
              enVendidos ? 'Sin ventas en el período' : 'Todo se vendió'
            }
            subtitle={
              enVendidos
                ? 'Cambiá de semana o de mes, o mirá todo el histórico.'
                : 'Cada producto activo del catálogo tuvo al menos una venta en el período.'
            }
          />
        }
        ListFooterComponent={
          ocultos > 0 ? (
            <Pressable
              onPress={() => setExpandido(true)}
              style={({ pressed }) => [
                styles.verTodos,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="list" size={16} color={colors.primary} />
              <Text style={styles.verTodosText}>
                Ver todos ({datos.length})
              </Text>
            </Pressable>
          ) : null
        }
        renderItem={({ item, index }) =>
          enVendidos ? (
            <FilaVendido
              fila={item as FilaVenta}
              puesto={index + 1}
              porUnidades={metrica === 'unidades'}
            />
          ) : (
            <FilaQuieto fila={item as FilaSinVenta} />
          )
        }
      />
    </Screen>
  );
}

function Columna({ valor, label }: { valor: string; label: string }) {
  return (
    <View style={styles.resumenCol}>
      <Text style={styles.resumenValor}>{valor}</Text>
      <Text style={styles.resumenLabel}>{label}</Text>
    </View>
  );
}

function Separador() {
  return <View style={styles.resumenSep} />;
}

function FilaVendido({
  fila,
  puesto,
  porUnidades,
}: {
  fila: FilaVenta;
  puesto: number;
  porUnidades: boolean;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.puesto}>
        <Text style={styles.puestoText}>{puesto}</Text>
      </View>
      <Text style={styles.nombre} numberOfLines={2}>
        {fila.nombre}
      </Text>
      <View style={styles.cifras}>
        <Text style={[styles.cifra, porUnidades ? styles.fuerte : styles.debil]}>
          {fila.unidades} u
        </Text>
        <Text style={[styles.cifra, porUnidades ? styles.debil : styles.fuerte]}>
          {formatCOP(fila.total)}
        </Text>
      </View>
    </View>
  );
}

function FilaQuieto({ fila }: { fila: FilaSinVenta }) {
  const nunca = fila.ultima_venta === null;
  return (
    <View style={styles.row}>
      <View style={[styles.puesto, nunca && styles.puestoNunca]}>
        <Ionicons
          name={nunca ? 'alert-circle-outline' : 'time-outline'}
          size={16}
          color={nunca ? colors.danger : colors.textMuted}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.nombre} numberOfLines={2}>
          {fila.nombre}
        </Text>
        <Text style={[styles.ultima, nunca && styles.ultimaNunca]}>
          {desdeUltimaVenta(fila.ultima_venta)}
        </Text>
      </View>
      <View style={styles.cifras}>
        <Text style={[styles.cifra, styles.fuerte]}>
          {fila.stock_actual} u
        </Text>
        <Text style={[styles.cifra, styles.debil]}>
          {formatCOP(fila.valor_stock)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
    marginBottom: spacing.md,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  tabOn: { backgroundColor: colors.surface, ...shadow },
  tabText: { fontSize: font.sm, fontWeight: '700', color: colors.textMuted },
  tabTextOn: { color: colors.text },
  chips: { flexDirection: 'row', gap: spacing.sm },
  chipFlex: { flex: 1, alignItems: 'center' },
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
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
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
  periodo: {
    flex: 1,
    textAlign: 'center',
    fontSize: font.md,
    fontWeight: '800',
    color: colors.text,
    textTransform: 'capitalize',
  },
  resumen: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
    paddingVertical: spacing.md,
  },
  resumenCol: { flex: 1, alignItems: 'center', gap: 2 },
  resumenSep: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: colors.border,
  },
  resumenValor: { fontSize: font.lg, fontWeight: '800', color: colors.text },
  resumenLabel: { fontSize: font.xs, color: colors.textMuted },
  ordenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginVertical: spacing.md,
  },
  dirBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dirText: { fontSize: font.sm, fontWeight: '700', color: colors.primary },
  nota: {
    fontSize: font.xs,
    color: colors.textMuted,
    marginVertical: spacing.md,
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
  puesto: {
    minWidth: 28,
    height: 28,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  puestoNunca: { backgroundColor: colors.danger + '18' },
  puestoText: { fontSize: font.xs, fontWeight: '800', color: colors.textMuted },
  nombre: { flex: 1, fontSize: font.md, color: colors.text },
  ultima: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
  ultimaNunca: { color: colors.danger, fontWeight: '700' },
  cifras: { alignItems: 'flex-end', gap: 2 },
  cifra: { fontSize: font.sm },
  fuerte: { fontWeight: '800', color: colors.text },
  debil: { fontWeight: '600', color: colors.textMuted },
  verTodos: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    marginTop: spacing.xs,
  },
  verTodosText: { fontSize: font.sm, fontWeight: '700', color: colors.primary },
});
