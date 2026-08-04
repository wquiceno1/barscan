import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Button, Card, Input, Screen } from '../components/ui';
import {
  listarFaltantes,
  resolverFaltante,
  type Faltante,
} from '../db/faltantes';
import { formatCOP } from '../db/util';
import { toast } from '../lib/feedback';
import { colors, font, radius, spacing } from '../theme/tokens';

export default function FaltantesScreen() {
  const db = useSQLiteContext();
  const [soloPendientes, setSoloPendientes] = useState(true);
  const [lista, setLista] = useState<Faltante[]>([]);
  const [notas, setNotas] = useState<Record<string, string>>({});

  const recargar = useCallback(() => {
    listarFaltantes(db, { soloPendientes }).then(setLista);
  }, [db, soloPendientes]);
  useFocusEffect(recargar);

  const resolver = async (f: Faltante) => {
    await resolverFaltante(db, f.id, notas[f.id] ?? '');
    toast('Faltante resuelto');
    setNotas((prev) => {
      const resto = { ...prev };
      delete resto[f.id];
      return resto;
    });
    recargar();
  };

  const pendientes = lista.filter((f) => f.resuelto === 0);
  const totalPend = pendientes.reduce((a, f) => a + f.diff_valor, 0);

  return (
    <Screen padded scroll>
      <Stack.Screen options={{ title: 'Faltantes' }} />

      <Card style={styles.resumen}>
        <Text style={styles.resumenLabel}>Pendientes por resolver</Text>
        <Text style={styles.resumenValor}>
          {pendientes.length} · {formatCOP(totalPend)}
        </Text>
        <View style={styles.toggle}>
          <Pressable
            onPress={() => setSoloPendientes(true)}
            style={[styles.tab, soloPendientes && styles.tabActivo]}
          >
            <Text
              style={[styles.tabText, soloPendientes && styles.tabTextActivo]}
            >
              Pendientes
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setSoloPendientes(false)}
            style={[styles.tab, !soloPendientes && styles.tabActivo]}
          >
            <Text
              style={[styles.tabText, !soloPendientes && styles.tabTextActivo]}
            >
              Todos
            </Text>
          </Pressable>
        </View>
      </Card>

      {lista.length === 0 ? (
        <Text style={styles.vacio}>
          {soloPendientes
            ? 'No hay faltantes pendientes. 👍'
            : 'Aún no se registraron faltantes.'}
        </Text>
      ) : (
        lista.map((f) => (
          <Card key={f.id} style={styles.item}>
            <View style={styles.itemHead}>
              <Text style={styles.itemNombre}>{f.nombre_snapshot}</Text>
              <Text
                style={[
                  styles.itemValor,
                  { color: f.diff_valor < 0 ? colors.danger : colors.venta },
                ]}
              >
                {formatCOP(f.diff_valor)}
              </Text>
            </View>
            <Text style={styles.itemMeta}>
              {f.mes} · esperado {f.esperado} · contado {f.contado} (
              {f.diff_unidades > 0 ? '+' : ''}
              {f.diff_unidades})
            </Text>

            {f.resuelto === 1 ? (
              <View style={styles.resueltoRow}>
                <Ionicons
                  name="checkmark-circle"
                  size={16}
                  color={colors.venta}
                />
                <Text style={styles.resueltoText}>
                  Resuelto{f.resolucion_nota ? `: ${f.resolucion_nota}` : ''}
                </Text>
              </View>
            ) : (
              <>
                <Input
                  label="¿Quién paga / cómo se maneja?"
                  value={notas[f.id] ?? ''}
                  onChangeText={(t) =>
                    setNotas((prev) => ({ ...prev, [f.id]: t }))
                  }
                  placeholder="Nota de resolución (opcional)"
                />
                <Button
                  label="Marcar resuelto"
                  icon="checkmark"
                  variant="secondary"
                  onPress={() => resolver(f)}
                />
              </>
            )}
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  resumen: { gap: spacing.sm, marginBottom: spacing.md },
  resumenLabel: { fontSize: font.sm, color: colors.textMuted },
  resumenValor: { fontSize: font.xl, fontWeight: '800', color: colors.text },
  toggle: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  tab: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabActivo: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { fontSize: font.sm, color: colors.textMuted, fontWeight: '700' },
  tabTextActivo: { color: colors.textInverse },
  vacio: { fontSize: font.md, color: colors.textMuted, textAlign: 'center' },
  item: { gap: spacing.sm, marginBottom: spacing.md },
  itemHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  itemNombre: { flex: 1, fontSize: font.md, fontWeight: '800', color: colors.text },
  itemValor: { fontSize: font.md, fontWeight: '800' },
  itemMeta: { fontSize: font.sm, color: colors.textMuted },
  resueltoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  resueltoText: { fontSize: font.sm, color: colors.textMuted, flex: 1 },
});
