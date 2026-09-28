import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius, spacing } from '../theme/tokens';
import ScannerView from './ScannerView';

// Escáner activable de las pantallas de operación (venta, compra, ajuste,
// salida, cambio). Arranca oculto y, mientras lo está, la cámara queda
// DESMONTADA: en Android no hay otra forma de apagarla (la prop `active` de
// CameraView es solo iOS) y expo-camera admite una sola vista previa activa a
// la vez. El estado abierto/cerrado vive en cada pantalla, para que ubique el
// recuadro y la barra donde estaban. Ver PLAN-ESCANER-ACTIVABLE.md.

type RecuadroProps = {
  activo: boolean;
  /** Alto del recuadro de cámara: cada pantalla conserva el que tenía. */
  altura: number;
  hint: string;
  onScan: (code: string) => void;
  paused?: boolean;
};

/** Recuadro de cámara con el texto de ayuda. No se monta mientras está oculto. */
export function RecuadroEscaner({
  activo,
  altura,
  hint,
  onScan,
  paused,
}: RecuadroProps) {
  if (!activo) return null;

  return (
    <View style={[styles.recuadro, { height: altura }]}>
      <ScannerView onScan={onScan} paused={paused} />
      <View style={styles.hint}>
        <Ionicons name="scan-outline" size={16} color={colors.textInverse} />
        <Text style={styles.hintText}>{hint}</Text>
      </View>
    </View>
  );
}

type BarraProps = {
  onBuscar: () => void;
  escanerActivo: boolean;
  onToggleEscaner: () => void;
};

/** Fila del buscador: abre la búsqueda por nombre y activa u oculta el escáner. */
export function BarraAgregar({
  onBuscar,
  escanerActivo,
  onToggleEscaner,
}: BarraProps) {
  return (
    <View style={styles.barra}>
      <Pressable
        onPress={onBuscar}
        style={({ pressed }) => [styles.buscar, pressed && styles.pressed]}
      >
        <Ionicons name="search" size={18} color={colors.primary} />
        <Text style={styles.buscarText}>Buscar producto por nombre</Text>
      </Pressable>
      <Pressable
        onPress={onToggleEscaner}
        accessibilityRole="button"
        accessibilityLabel={escanerActivo ? 'Ocultar escáner' : 'Activar escáner'}
        accessibilityState={{ expanded: escanerActivo }}
        style={({ pressed }) => [
          styles.scanBtn,
          escanerActivo && styles.scanBtnOn,
          pressed && styles.pressed,
        ]}
      >
        <Ionicons
          name={escanerActivo ? 'close' : 'scan-outline'}
          size={22}
          color={colors.textInverse}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.85 },
  recuadro: { backgroundColor: '#000' },
  hint: {
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
  hintText: { color: colors.textInverse, fontSize: font.xs },
  barra: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  buscar: {
    flex: 1,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  buscarText: { color: colors.primary, fontSize: font.md, fontWeight: '700' },
  // Mismo botón que el de escanear de Historial y Catálogo.
  scanBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanBtnOn: { backgroundColor: colors.text },
});
