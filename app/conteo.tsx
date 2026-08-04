import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Button, Card, Input, Screen } from '../components/ui';
import { getConteoMuestra } from '../db/configuracion';
import {
  productosParaContar,
  progresoCiclo,
  registrarConteo,
} from '../db/faltantes';
import type { Producto } from '../db/types';
import { formatCOP } from '../db/util';
import { toast } from '../lib/feedback';
import { colors, font, radius, spacing } from '../theme/tokens';

export default function ConteoScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [lista, setLista] = useState<Producto[] | null>(null);
  const [texto, setTexto] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [progreso, setProgreso] = useState<{
    contados: number;
    total: number;
  } | null>(null);

  const cargar = useCallback(() => {
    getConteoMuestra(db).then((m) =>
      productosParaContar(db, m).then(setLista)
    );
    progresoCiclo(db).then(setProgreso);
  }, [db]);
  useFocusEffect(cargar);

  const actual = lista && lista.length > 0 ? lista[0] : null;

  const confirmar = async () => {
    if (!actual) return;
    const limpio = texto.replace(/[^\d]/g, '');
    if (limpio === '') {
      Alert.alert('Falta la cantidad', 'Ingresa cuántas unidades contaste.');
      return;
    }
    setGuardando(true);
    try {
      const falt = await registrarConteo(db, actual.barcode, Number(limpio));
      if (falt) {
        const signo = falt.diff_unidades > 0 ? '+' : '';
        toast(
          `Descuadre ${signo}${falt.diff_unidades} · ${formatCOP(falt.diff_valor)}`
        );
      } else {
        toast('Cuadra ✓');
      }
      setTexto('');
      setLista((prev) => (prev ? prev.slice(1) : prev));
      progresoCiclo(db).then(setProgreso);
    } catch (e) {
      Alert.alert('Error', String(e));
    } finally {
      setGuardando(false);
    }
  };

  const pct =
    progreso && progreso.total > 0
      ? Math.round((progreso.contados / progreso.total) * 100)
      : 0;

  return (
    <Screen padded scroll>
      <Stack.Screen options={{ title: 'Chequeo de inventario' }} />

      {progreso && (
        <Card style={styles.progresoCard}>
          <Text style={styles.progresoLabel}>Cobertura del catálogo</Text>
          <Text style={styles.progresoValor}>
            {progreso.contados} / {progreso.total} ({pct}%)
          </Text>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${pct}%` }]} />
          </View>
        </Card>
      )}

      {lista === null ? (
        <Text style={styles.info}>Cargando muestra…</Text>
      ) : actual ? (
        <Card style={styles.form}>
          <Text style={styles.instru}>Contá cuántas unidades hay de:</Text>
          <Text style={styles.nombre}>{actual.nombre}</Text>
          <Text style={styles.barcode}>{actual.barcode}</Text>
          <Input
            label="Unidades contadas"
            keyboardType="numeric"
            value={texto}
            onChangeText={setTexto}
            placeholder="0"
            selectTextOnFocus
            autoFocus
          />
          <Button
            label="Confirmar conteo"
            icon="checkmark"
            loading={guardando}
            onPress={confirmar}
          />
          <Text style={styles.restante}>
            Quedan {lista.length} en la muestra de este mes.
          </Text>
        </Card>
      ) : (
        <Card style={styles.done}>
          <Ionicons
            name="checkmark-done-circle"
            size={44}
            color={colors.venta}
          />
          <Text style={styles.nombre}>Muestra del mes completada</Text>
          <Text style={styles.info}>
            Revisá los descuadres detectados en el panel de faltantes.
          </Text>
          <Button
            label="Ver faltantes"
            icon="alert-circle-outline"
            variant="secondary"
            onPress={() => router.push('/faltantes')}
          />
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  progresoCard: { gap: spacing.xs, marginBottom: spacing.md },
  progresoLabel: { fontSize: font.sm, color: colors.textMuted },
  progresoValor: { fontSize: font.xl, fontWeight: '800', color: colors.text },
  barTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
    marginTop: spacing.xs,
  },
  barFill: { height: 8, borderRadius: 4, backgroundColor: colors.primary },
  form: { gap: spacing.md },
  done: { gap: spacing.md, alignItems: 'center' },
  instru: { fontSize: font.sm, color: colors.textMuted },
  nombre: { fontSize: font.xl, fontWeight: '800', color: colors.text },
  barcode: {
    fontSize: font.sm,
    color: colors.textMuted,
    backgroundColor: colors.surfaceAlt,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  restante: {
    fontSize: font.sm,
    color: colors.textMuted,
    textAlign: 'center',
  },
  info: { fontSize: font.md, color: colors.textMuted, textAlign: 'center' },
});
