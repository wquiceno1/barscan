import { StyleSheet, Text, View } from 'react-native';
import { colors, font, radius, spacing } from '../../theme/tokens';

type Props = {
  /** Avance entre 0 y 1; se recorta al rango válido. */
  valor: number;
  /** Qué se está haciendo ahora (ej. "Descargando respaldo"). */
  etiqueta?: string;
  /** Línea secundaria, típicamente "hechos / total". */
  detalle?: string;
};

/** Barra de progreso determinada, para operaciones largas de respaldo. */
export default function ProgressBar({ valor, etiqueta, detalle }: Props) {
  const pct = Math.round(Math.min(Math.max(valor, 0), 1) * 100);

  return (
    <View
      style={styles.wrap}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: pct }}
    >
      {(etiqueta || detalle) && (
        <View style={styles.head}>
          {etiqueta ? <Text style={styles.etiqueta}>{etiqueta}</Text> : null}
          <Text style={styles.pct}>{pct}%</Text>
        </View>
      )}
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%` }]} />
      </View>
      {detalle ? <Text style={styles.detalle}>{detalle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  etiqueta: {
    flex: 1,
    fontSize: font.sm,
    fontWeight: '700',
    color: colors.text,
  },
  pct: { fontSize: font.sm, fontWeight: '800', color: colors.primary },
  track: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  detalle: { fontSize: font.xs, color: colors.textMuted },
});
