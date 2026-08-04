import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Screen } from '../../components/ui';
import { colors, font, radius, shadow, spacing } from '../../theme/tokens';

type IconName = keyof typeof Ionicons.glyphMap;

/** Acción protagonista (Nueva venta): grande, a todo el ancho, arriba. */
function AccionHero({
  onPress,
  label,
  icon,
  color,
}: {
  onPress: () => void;
  label: string;
  icon: IconName;
  color: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.hero, pressed && styles.pressed]}
    >
      <View style={[styles.heroIcon, { backgroundColor: color }]}>
        <Ionicons name={icon} size={34} color={colors.textInverse} />
      </View>
      <Text style={styles.heroLabel}>{label}</Text>
      {/* <Ionicons name="chevron-forward" size={26} color={colors.textMuted} /> */}
    </Pressable>
  );
}

/** Acción secundaria: tile compacto (ícono + etiqueta), 2 por fila. */
function AccionTile({
  onPress,
  label,
  icon,
  color,
}: {
  onPress: () => void;
  label: string;
  icon: IconName;
  color: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
    >
      <View style={[styles.tileIcon, { backgroundColor: color }]}>
        <Ionicons name={icon} size={24} color={colors.textInverse} />
      </View>
      <Text style={styles.tileLabel}>{label}</Text>
    </Pressable>
  );
}

export default function OperarScreen() {
  const router = useRouter();

  return (
    <Screen padded scroll style={styles.contenido}>
      {/* <Text style={styles.title}>¿Qué quieres registrar?</Text> */}

      <AccionHero
        onPress={() => router.push('/transaccion/venta')}
        label="Nueva venta"
        icon="cart"
        color={colors.venta}
      />

      <View style={styles.grid}>
        <AccionTile
          onPress={() => router.push('/transaccion/compra')}
          label="Compra"
          icon="cube"
          color={colors.compra}
        />
        <AccionTile
          onPress={() => router.push('/transaccion/ajuste')}
          label="Ajuste"
          icon="construct"
          color={colors.ajuste}
        />
        <AccionTile
          onPress={() => router.push('/salida')}
          label="Salida"
          icon="exit"
          color={colors.salida}
        />
        <AccionTile
          onPress={() => router.push('/transporte')}
          label="Transporte"
          icon="bus"
          color={colors.transporte}
        />
        <AccionTile
          onPress={() => router.push('/cambio')}
          label="Cambio"
          icon="swap-horizontal"
          color={colors.danger}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Empuja el bloque (título + tarjetas) al fondo: espacio libre arriba, acciones
  // al alcance del pulgar. Si el contenido no cabe, el ScrollView permite subir.
  contenido: { justifyContent: 'flex-end' },
  title: {
    fontSize: font.xxl,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.lg,
  },
  pressed: { opacity: 0.85 },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    marginBottom: spacing.lg,
    ...shadow,
  },
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroLabel: { fontSize: font.xl, fontWeight: '800', color: colors.text },
  grid: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    columnGap: spacing.sm,
    rowGap: spacing.sm,
  },
  tile: {
    width: '31%',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    ...shadow,
  },
  tileIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: { fontSize: font.md, fontWeight: '700', color: colors.text },
});
