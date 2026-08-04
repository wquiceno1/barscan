import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Button, Card, Input, Screen } from '../../components/ui';
import { getSalarioPct } from '../../db/configuracion';
import {
  getEfectivoPeriodo,
  liquidarPeriodo,
  listarLiquidaciones,
  resumenPeriodo,
  setEfectivoPeriodo,
  type Liquidacion,
  type ResumenPeriodo,
} from '../../db/liquidaciones';
import { toast } from '../../lib/feedback';
import {
  deducciones,
  inventarioInicial,
  productosVendidos,
  resumenVentasDia,
  salidasColegio,
  totalPorTipo,
  valorInventario,
  type FilaDeduccion,
  type ResumenDia,
} from '../../db/reportes';
import { progresoCiclo } from '../../db/faltantes';
import { labelSubcat } from '../../db/salidas';
import { totalTransporte } from '../../db/transportes';
import { formatCOP } from '../../db/util';
import {
  compartirReportePdf,
  reporteInventarioInicial,
  reporteVentas,
  type ReportePdf,
} from '../../lib/reportePdf';
import {
  dateADiaStr,
  diaADate,
  fechaLarga,
  hoyStr,
  rangoDia,
  sumarDias,
} from '../../lib/fecha';
import { colors, font, spacing } from '../../theme/tokens';

/** Rango del mes en `offset` meses respecto al actual (0 = mes actual). */
function rangoMes(offset: number): { desde: string; hasta: string } {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return { desde: `${y}-${m}-01T00:00:00`, hasta: `${y}-${m}-31T23:59:59` };
}

/** Etiqueta legible del mes en `offset` meses respecto al actual: "Julio 2026". */
function labelMes(offset: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  const texto = d.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

type DatosMes = {
  ventas: number;
  compras: number;
  transporte: number;
  colegio: number;
  deducciones: number;
  deduccionesFilas: FilaDeduccion[];
};

/** Desglose de deducciones por subcategoría, para la nota del KPI. */
function desgloseDeducciones(filas?: FilaDeduccion[]): string | undefined {
  if (!filas || filas.length === 0) return undefined;
  return filas
    .map((f) => `${labelSubcat(f.subcategoria)}: ${formatCOP(f.total)}`)
    .join(' · ');
}

type Inventario = { alCosto: number; alPrecio: number };

type IconName = keyof typeof Ionicons.glyphMap;

export default function ReportesScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [d, setD] = useState<DatosMes | null>(null);
  const [inv, setInv] = useState<Inventario | null>(null);
  const [dia, setDia] = useState(hoyStr());
  const [resumen, setResumen] = useState<ResumenDia | null>(null);
  const [mostrarPicker, setMostrarPicker] = useState(false);
  const [mesOffset, setMesOffset] = useState(0);
  const [salarioPct, setSalarioPct] = useState(7);
  const [salarioAbierto, setSalarioAbierto] = useState(false);
  // Período de liquidación (trimestral, disparado a mano). `efectivoContado` es
  // el conteo de caja del período (null = usar el estimado); `efectivoTexto` es
  // el borrador del input.
  const [periodo, setPeriodo] = useState<ResumenPeriodo | null>(null);
  const [efectivoContado, setEfectivoContado] = useState<number | null>(null);
  const [efectivoTexto, setEfectivoTexto] = useState('');
  const [cobertura, setCobertura] = useState<{
    contados: number;
    total: number;
  } | null>(null);
  const [liquidaciones, setLiquidaciones] = useState<Liquidacion[]>([]);
  const [historialAbierto, setHistorialAbierto] = useState(false);
  const [pdfCargando, setPdfCargando] = useState<
    null | 'inv' | 'histo' | 'dia' | 'mes'
  >(null);

  const esHoy = dia === hoyStr();
  const esMesActual = mesOffset === 0;

  // Salario del encargado = % configurable × (efectivo + inversiones), sobre el
  // ACUMULADO del período de liquidación (trimestral, disparado a mano).
  // Inversiones = compras + transporte del período; efectivo estimado =
  // ventas − compras − transporte, sobreescribible con el conteo real de caja.
  // Ver PLAN-AJUSTE-SALARIO.md / PLAN-CUADRE-MENSUAL.md.
  const inversiones = periodo ? periodo.inversiones : 0;
  const efectivoEstimado = periodo ? periodo.efectivoEstimado : 0;
  const efectivoUsado = efectivoContado ?? efectivoEstimado;
  const salarioBase = efectivoUsado + inversiones;
  const salario = Math.round((salarioBase * salarioPct) / 100);

  // Carga el período actual (agregados, efectivo, cobertura, historial).
  const cargarPeriodo = useCallback(() => {
    resumenPeriodo(db).then(setPeriodo);
    getEfectivoPeriodo(db).then((v) => {
      setEfectivoContado(v);
      setEfectivoTexto(v == null ? '' : String(v));
    });
    progresoCiclo(db).then(setCobertura);
    listarLiquidaciones(db).then(setLiquidaciones);
  }, [db]);

  // Guarda el conteo de efectivo del período (texto vacío = volver al estimado).
  const guardarEfectivo = async () => {
    const limpio = efectivoTexto.replace(/[^\d]/g, '');
    const monto = limpio === '' ? null : Number(limpio);
    await setEfectivoPeriodo(db, monto);
    setEfectivoContado(monto);
    toast(monto == null ? 'Efectivo en estimado' : 'Efectivo guardado');
  };

  const usarEstimado = async () => {
    await setEfectivoPeriodo(db, null);
    setEfectivoContado(null);
    setEfectivoTexto('');
    toast('Efectivo en estimado');
  };

  // Liquida el período: calcula salario y cuadre sobre el acumulado, guarda el
  // snapshot en `liquidaciones` y arranca un período nuevo.
  const liquidar = () => {
    if (!periodo) return;
    Alert.alert(
      'Liquidar período',
      `Se cierra el período: salario ${formatCOP(
        salario
      )} · inventario ${formatCOP(
        periodo.inventarioActual
      )}. Arranca un período nuevo. ¿Continuar?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Liquidar',
          onPress: async () => {
            await liquidarPeriodo(db, { efectivoContado });
            toast('Período liquidado');
            cargarPeriodo();
          },
        },
      ]
    );
  };

  // Genera un PDF y abre el diálogo nativo de compartir/imprimir. `construir`
  // devuelve null cuando el reporte no tiene filas.
  const generarPdf = async (
    clave: NonNullable<typeof pdfCargando>,
    construir: () => Promise<ReportePdf | null>
  ) => {
    setPdfCargando(clave);
    try {
      const reporte = await construir();
      if (!reporte) {
        Alert.alert('Sin datos', 'No hay información para este reporte todavía.');
        return;
      }
      await compartirReportePdf(reporte);
    } catch (e) {
      Alert.alert(
        'No se pudo generar el PDF',
        (e as Error)?.message ?? 'Error desconocido.'
      );
    } finally {
      setPdfCargando(null);
    }
  };

  const pdfInventario = () =>
    generarPdf('inv', async () => {
      const { filas, total } = await inventarioInicial(db);
      return filas.length ? reporteInventarioInicial(filas, total) : null;
    });

  const pdfVentasHistorico = () =>
    generarPdf('histo', async () => {
      const { filas, total } = await productosVendidos(db);
      return filas.length ? reporteVentas(filas, total) : null;
    });

  const pdfVentasDia = () =>
    generarPdf('dia', async () => {
      const { filas, total } = await productosVendidos(db, rangoDia(dia));
      const etiqueta = esHoy ? 'Hoy' : fechaLarga(dia);
      return filas.length ? reporteVentas(filas, total, etiqueta) : null;
    });

  const pdfVentasMes = () =>
    generarPdf('mes', async () => {
      const { filas, total } = await productosVendidos(db, rangoMes(mesOffset));
      return filas.length ? reporteVentas(filas, total, labelMes(mesOffset)) : null;
    });

  // Resumen del día seleccionado: recarga al cambiar la fecha y al volver a la
  // pantalla (p. ej. tras registrar una venta).
  useFocusEffect(
    useCallback(() => {
      resumenVentasDia(db, dia).then(setResumen);
    }, [db, dia])
  );

  // Valor de inventario: es una foto del stock actual, no depende del mes
  // seleccionado — se recarga solo al volver a la pantalla.
  useFocusEffect(
    useCallback(() => {
      valorInventario(db).then(setInv);
    }, [db])
  );

  // Porcentaje del salario (configurable en Ajustes): se recarga al volver.
  useFocusEffect(
    useCallback(() => {
      getSalarioPct(db).then(setSalarioPct);
    }, [db])
  );

  // Período de liquidación: se recarga al volver a la pantalla.
  useFocusEffect(cargarPeriodo);

  useFocusEffect(
    useCallback(() => {
      const { desde, hasta } = rangoMes(mesOffset);
      Promise.all([
        totalPorTipo(db, 'venta', desde, hasta),
        totalPorTipo(db, 'compra', desde, hasta),
        totalTransporte(db, { desde, hasta }),
        salidasColegio(db, { desde, hasta }),
        deducciones(db, { desde, hasta }),
      ]).then(([ventas, compras, transporte, colegio, ded]) =>
        setD({
          ventas,
          compras,
          transporte,
          colegio: colegio.total,
          deducciones: ded.total,
          deduccionesFilas: ded.filas,
        })
      );
    }, [db, mesOffset])
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.section}>Ventas del día</Text>
        <Card style={styles.diaCard}>
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
        </Card>

        <Kpi
          icon="cash"
          label="Total vendido"
          value={resumen?.total}
          color={colors.venta}
          big
        />

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

        <Text style={styles.section}>Inventario actual</Text>
        <Kpi
          icon="pricetag"
          label="Valor del inventario"
          value={inv?.alPrecio}
        />

        <Text style={styles.section}>Ventas por mes</Text>
        <Card style={styles.diaCard}>
          <View style={styles.diaNav}>
            <Pressable
              onPress={() => setMesOffset((x) => x - 1)}
              hitSlop={8}
              style={styles.navBtn}
            >
              <Ionicons name="chevron-back" size={22} color={colors.text} />
            </Pressable>
            <Text style={styles.diaFecha}>{labelMes(mesOffset)}</Text>
            <Pressable
              onPress={() => setMesOffset((x) => x + 1)}
              disabled={esMesActual}
              hitSlop={8}
              style={[styles.navBtn, esMesActual && styles.navBtnOff]}
            >
              <Ionicons name="chevron-forward" size={22} color={colors.text} />
            </Pressable>
          </View>
          {!esMesActual && (
            <Pressable onPress={() => setMesOffset(0)} style={styles.hoyBtn}>
              <Ionicons name="today-outline" size={14} color={colors.primary} />
              <Text style={styles.hoyBtnText}>Volver a este mes</Text>
            </Pressable>
          )}
        </Card>

        <Kpi icon="cart" label="Ventas" value={d?.ventas} color={colors.venta} />
        <Kpi
          icon="download"
          label="Compras"
          value={d?.compras}
          color={colors.compra}
        />
        <Kpi
          icon="bus"
          label="Transporte"
          value={d?.transporte}
          color={colors.transporte}
        />
        <Kpi
          icon="school"
          label="Entregado al colegio"
          value={d?.colegio}
          color={colors.salida}
        />
        <Kpi
          icon="exit"
          label="Deducciones"
          value={d?.deducciones}
          color={colors.salida}
          caption={desgloseDeducciones(d?.deduccionesFilas)}
        />

        <Text style={styles.section}>Período de liquidación</Text>

        {periodo != null && periodo.mesesTranscurridos >= 3 && (
          <Card style={styles.avisoCard}>
            <Ionicons name="alarm" size={20} color={colors.ajuste} />
            <Text style={styles.avisoText}>
              Este período lleva {periodo.mesesTranscurridos} meses. Suele
              liquidarse cada 3 — cuando quieras, tocá “Liquidar período”.
            </Text>
          </Card>
        )}

        <Card style={styles.salarioCard}>
          <Text style={styles.periodoInfo}>
            {periodo == null
              ? '—'
              : `${periodo.inicio ? `Desde ${periodo.desde.slice(0, 10)}` : 'Primer período'} · ${periodo.mesesTranscurridos} ${
                  periodo.mesesTranscurridos === 1 ? 'mes' : 'meses'
                }`}
          </Text>
          <Pressable
            style={styles.salarioHead}
            onPress={() => setSalarioAbierto((v) => !v)}
          >
            <View
              style={[
                styles.kpiIcon,
                { backgroundColor: colors.primary + '1a' },
              ]}
            >
              <Ionicons name="wallet" size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.kpiLabel}>
                Salario a liquidar ({salarioPct}%)
              </Text>
              <Text
                style={[
                  styles.kpiValue,
                  styles.kpiValueBig,
                  { color: colors.primary },
                ]}
              >
                {periodo == null ? '—' : formatCOP(salario)}
              </Text>
            </View>
            <Ionicons
              name={salarioAbierto ? 'chevron-up' : 'chevron-down'}
              size={22}
              color={colors.textMuted}
            />
          </Pressable>
          {salarioAbierto && (
            <View style={styles.salarioBody}>
              <FilaSalario
                label={
                  efectivoContado != null
                    ? 'Efectivo (conteo)'
                    : 'Efectivo (estimado)'
                }
                value={periodo ? efectivoUsado : undefined}
              />
              <FilaSalario
                label="Inversiones (compras + transporte)"
                value={periodo ? inversiones : undefined}
              />
              <View style={styles.salarioDivider} />
              <FilaSalario
                label="Base (suma)"
                value={periodo ? salarioBase : undefined}
                bold
              />
              <FilaSalario
                label={`Salario (${salarioPct}%)`}
                value={periodo ? salario : undefined}
                bold
                color={colors.primary}
              />

              <View style={styles.efectivoBox}>
                <Text style={styles.efectivoHelp}>
                  Efectivo estimado del período:{' '}
                  {periodo ? formatCOP(efectivoEstimado) : '—'} (ventas −
                  compras − transporte). Ajustalo con el conteo real de la caja
                  al liquidar.
                </Text>
                <Input
                  label="Efectivo contado (opcional)"
                  keyboardType="numeric"
                  value={efectivoTexto}
                  onChangeText={setEfectivoTexto}
                  placeholder="Vacío = usar estimado"
                  selectTextOnFocus
                />
                <Button
                  label="Guardar efectivo"
                  icon="save"
                  onPress={guardarEfectivo}
                />
                {efectivoContado != null && (
                  <Pressable onPress={usarEstimado} style={styles.hoyBtn}>
                    <Ionicons name="refresh" size={14} color={colors.primary} />
                    <Text style={styles.hoyBtnText}>Usar estimado</Text>
                  </Pressable>
                )}
              </View>
            </View>
          )}
        </Card>

        <Card style={styles.cuadreCard}>
          <FilaSalario
            label="Inventario actual (a precio)"
            value={periodo?.inventarioActual}
          />
          <FilaSalario
            label="Inventario base (últ. liquidación)"
            value={periodo?.inventarioBase ?? undefined}
          />
          <FilaSalario
            label="Ganancia del período"
            value={periodo?.ganancia}
            color={colors.venta}
          />
          {periodo != null && periodo.coberturaGanancia < 1 && (
            <Text style={styles.cuadreNota}>
              Ganancia sobre {Math.round(periodo.coberturaGanancia * 100)}% de
              las ventas (solo líneas con costo conocido).
            </Text>
          )}
          <FilaSalario
            label="Faltantes del período"
            value={periodo?.faltantesValor}
            color={
              periodo && periodo.faltantesValor < 0
                ? colors.danger
                : colors.text
            }
          />

          <View style={styles.salarioDivider} />

          <View style={styles.cuadreChequeo}>
            <Ionicons
              name="clipboard-outline"
              size={18}
              color={colors.primary}
            />
            <Text style={styles.cuadreChequeoText}>
              Chequeo:{' '}
              {cobertura
                ? `${cobertura.contados}/${cobertura.total} del catálogo contados`
                : '—'}
              {periodo ? ` · ${periodo.faltantesCantidad} descuadres` : ''}
            </Text>
          </View>

          <Button
            label="Chequeo de inventario"
            icon="clipboard-outline"
            onPress={() => router.push('/conteo')}
          />
          <Button
            label="Ver faltantes"
            icon="alert-circle-outline"
            variant="secondary"
            onPress={() => router.push('/faltantes')}
          />
          <Button
            label="Liquidar período"
            icon="lock-closed-outline"
            onPress={liquidar}
          />
        </Card>

        {liquidaciones.length > 0 && (
          <Card style={styles.salarioCard}>
            <Pressable
              style={styles.salarioHead}
              onPress={() => setHistorialAbierto((v) => !v)}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.kpiLabel}>
                  Liquidaciones anteriores ({liquidaciones.length})
                </Text>
              </View>
              <Ionicons
                name={historialAbierto ? 'chevron-up' : 'chevron-down'}
                size={22}
                color={colors.textMuted}
              />
            </Pressable>
            {historialAbierto && (
              <View style={styles.salarioBody}>
                {liquidaciones.map((l) => (
                  <View key={l.id} style={styles.filaSalario}>
                    <Text style={styles.filaLabel}>
                      {l.fecha_hora.slice(0, 10)}
                    </Text>
                    <Text style={styles.filaValue}>
                      Salario {formatCOP(l.salario)}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </Card>
        )}

        <Text style={styles.section}>Reportes imprimibles</Text>
        <Card style={{ gap: spacing.sm }}>
          <Text style={styles.pdfHelp}>
            Genera un PDF para imprimir o compartir por WhatsApp, correo o Drive.
          </Text>
          <Button
            label="Inventario inicial (PDF)"
            icon="cube-outline"
            variant="secondary"
            loading={pdfCargando === 'inv'}
            onPress={pdfInventario}
          />
          <Button
            label="Ventas — histórico completo (PDF)"
            icon="cart-outline"
            variant="secondary"
            loading={pdfCargando === 'histo'}
            onPress={pdfVentasHistorico}
          />
          <Button
            label={`Ventas del día (${esHoy ? 'Hoy' : fechaLarga(dia)})`}
            icon="calendar-outline"
            variant="secondary"
            loading={pdfCargando === 'dia'}
            onPress={pdfVentasDia}
          />
          <Button
            label={`Ventas del mes (${labelMes(mesOffset)})`}
            icon="calendar-number-outline"
            variant="secondary"
            loading={pdfCargando === 'mes'}
            onPress={pdfVentasMes}
          />
        </Card>
      </ScrollView>
    </Screen>
  );
}

function Kpi({
  icon,
  label,
  value,
  color = colors.text,
  big = false,
  caption,
}: {
  icon: IconName;
  label: string;
  value?: number;
  color?: string;
  big?: boolean;
  caption?: string;
}) {
  return (
    <Card style={styles.kpi}>
      <View style={[styles.kpiIcon, { backgroundColor: color + '1a' }]}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.kpiLabel}>{label}</Text>
        <Text style={[styles.kpiValue, big && styles.kpiValueBig, { color }]}>
          {value == null ? '—' : formatCOP(value)}
        </Text>
        {caption && <Text style={styles.kpiCaption}>{caption}</Text>}
      </View>
    </Card>
  );
}

/** Fila del desglose del salario: etiqueta a la izquierda, valor a la derecha. */
function FilaSalario({
  label,
  value,
  bold = false,
  color = colors.text,
}: {
  label: string;
  value?: number;
  bold?: boolean;
  color?: string;
}) {
  return (
    <View style={styles.filaSalario}>
      <Text style={[styles.filaLabel, bold && styles.filaBold]}>{label}</Text>
      <Text style={[styles.filaValue, bold && styles.filaBold, { color }]}>
        {value == null ? '—' : formatCOP(value)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md },
  section: {
    fontSize: font.xs,
    fontWeight: '800',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.sm,
  },
  diaCard: { gap: spacing.sm },
  diaNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  },
  hoyBtnText: { fontSize: font.sm, color: colors.primary, fontWeight: '700' },
  kpi: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  kpiIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pdfHelp: { fontSize: font.sm, color: colors.textMuted },
  kpiLabel: { fontSize: font.sm, color: colors.textMuted },
  kpiCaption: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
  kpiValue: { fontSize: font.xl, fontWeight: '800', marginTop: 2 },
  kpiValueBig: { fontSize: font.xxl },
  salarioCard: { gap: spacing.sm },
  salarioHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  salarioBody: {
    gap: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  salarioDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  filaSalario: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  filaLabel: { fontSize: font.md, color: colors.textMuted },
  filaValue: { fontSize: font.md, color: colors.text, fontWeight: '600' },
  filaBold: { fontWeight: '800', color: colors.text },
  efectivoBox: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  efectivoHelp: { fontSize: font.xs, color: colors.textMuted },
  cuadreCard: { gap: spacing.sm },
  cuadreNota: { fontSize: font.xs, color: colors.textMuted },
  cuadreChequeo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  cuadreChequeoText: { flex: 1, fontSize: font.sm, color: colors.text },
  avisoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.ajuste + '14',
    borderWidth: 1,
    borderColor: colors.ajuste + '40',
  },
  avisoText: { flex: 1, fontSize: font.sm, color: colors.text },
  periodoInfo: { fontSize: font.xs, color: colors.textMuted },
});
