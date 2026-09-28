import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { EmptyState } from './ui';
import { listarProductos } from '../db/productos';
import { listarContrapartes, type Contraparte } from '../db/transacciones';
import type { Producto } from '../db/types';
import { contienePalabras, palabrasBusqueda } from '../db/util';
import { colors, font, radius, spacing } from '../theme/tokens';

/** Lo que se eligió en el buscador. Cómo filtra lo decide la pantalla. */
export type SeleccionHistorial =
  // Todo lo que contenga el texto: cualquier producto con esas palabras o ese
  // código. No es una sugerencia: se aplica con "Buscar" en el teclado.
  | { por: 'texto'; texto: string }
  // Un producto exacto, por código.
  | { por: 'producto'; barcode: string; nombre: string }
  // Un cliente o proveedor, con todas las grafías con que se cargó.
  | { por: 'contraparte'; contraparte: Contraparte };

type Props = {
  /** Lo que se está escribiendo en el campo de búsqueda del historial. */
  busqueda: string;
  onElegir: (seleccion: SeleccionHistorial) => void;
};

type Resultado =
  | { clave: string; clase: 'producto'; producto: Producto; inactivo: boolean }
  | { clave: string; clase: 'contraparte'; contraparte: Contraparte };

type Seccion = { titulo: string; data: Resultado[] };

const ROL: Record<Contraparte['tipo'], string> = {
  venta: 'Cliente',
  compra: 'Proveedor',
};

/**
 * Sugerencias del buscador del historial, en la misma pantalla: aparecen
 * mientras se escribe, en lugar de la lista de operaciones, para elegir
 * exactamente qué buscar: los productos del catálogo (también los
 * desactivados, que tienen historial) y los clientes y proveedores cargados en
 * ventas y compras.
 */
export default function SugerenciasHistorial({ busqueda, onElegir }: Props) {
  const db = useSQLiteContext();
  const [productos, setProductos] = useState<
    { producto: Producto; inactivo: boolean }[]
  >([]);
  const [contrapartes, setContrapartes] = useState<Contraparte[]>([]);

  // Los nombres se cargan una vez al empezar a buscar (son pocos; se filtran
  // en memoria mientras se escribe).
  useEffect(() => {
    listarContrapartes(db).then(setContrapartes);
  }, [db]);

  // Productos: activos primero, después los desactivados. `vigente` descarta
  // respuestas viejas si se escribe más rápido de lo que responde la base.
  useEffect(() => {
    const termino = busqueda.trim();
    if (!termino) {
      setProductos([]);
      return;
    }
    let vigente = true;
    Promise.all([
      listarProductos(db, termino),
      listarProductos(db, termino, { soloInactivos: true }),
    ]).then(([activos, inactivos]) => {
      if (!vigente) return;
      setProductos([
        ...activos.map((producto) => ({ producto, inactivo: false })),
        ...inactivos.map((producto) => ({ producto, inactivo: true })),
      ]);
    });
    return () => {
      vigente = false;
    };
  }, [busqueda, db]);

  const termino = busqueda.trim();
  const palabras = palabrasBusqueda(termino);
  const nombres = palabras.length
    ? contrapartes.filter((c) => contienePalabras(c.nombre, palabras))
    : [];

  const secciones: Seccion[] = termino
    ? [
        ...(productos.length
          ? [
              {
                titulo: 'Productos',
                data: productos.map(
                  ({ producto, inactivo }): Resultado => ({
                    clave: `p:${producto.barcode}`,
                    clase: 'producto',
                    producto,
                    inactivo,
                  })
                ),
              },
            ]
          : []),
        ...(nombres.length
          ? [
              {
                titulo: 'Clientes y proveedores',
                data: nombres.map(
                  (contraparte): Resultado => ({
                    clave: `c:${contraparte.tipo}:${contraparte.nombre}`,
                    clase: 'contraparte',
                    contraparte,
                  })
                ),
              },
            ]
          : []),
      ]
    : [];

  return (
    <SectionList
      sections={secciones}
      keyExtractor={(r) => r.clave}
      keyboardShouldPersistTaps="handled"
      stickySectionHeadersEnabled={false}
      contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.xl }}
      renderSectionHeader={({ section }) => (
        <Text style={styles.seccion}>{section.titulo}</Text>
      )}
      ListEmptyComponent={
        termino ? (
          <EmptyState
            icon="search-outline"
            title="Sin coincidencias"
            subtitle={`Ningún producto, cliente ni proveedor coincide con «${termino}».`}
          />
        ) : (
          <EmptyState
            icon="search-outline"
            title="Buscá en el historial"
            subtitle="Escribí el nombre de un producto, un cliente o un proveedor."
          />
        )
      }
      renderItem={({ item }) => {
        if (item.clase === 'producto') {
          const { producto, inactivo } = item;
          return (
            <FilaResultado
              icono="cube-outline"
              titulo={producto.nombre}
              detalle={`${producto.barcode}${inactivo ? ' · desactivado' : ''}`}
              onPress={() =>
                onElegir({
                  por: 'producto',
                  barcode: producto.barcode,
                  nombre: producto.nombre,
                })
              }
            />
          );
        }
        const { contraparte } = item;
        const n = contraparte.operaciones;
        return (
          <FilaResultado
            icono={
              contraparte.tipo === 'venta' ? 'person-outline' : 'storefront-outline'
            }
            titulo={contraparte.nombre}
            // "En total": el conteo es de todo el historial, no del alcance elegido.
            detalle={`${ROL[contraparte.tipo]} · ${n} ${
              n === 1 ? 'operación' : 'operaciones'
            } en total`}
            onPress={() => onElegir({ por: 'contraparte', contraparte })}
          />
        );
      }}
    />
  );
}

function FilaResultado({
  icono,
  titulo,
  detalle,
  onPress,
}: {
  icono: keyof typeof Ionicons.glyphMap;
  titulo: string;
  detalle: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      onPress={onPress}
    >
      <Ionicons name={icono} size={20} color={colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={styles.nombre}>{titulo}</Text>
        <Text style={styles.meta}>{detalle}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.85 },
  seccion: {
    fontSize: font.xs,
    fontWeight: '800',
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginTop: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  nombre: { fontSize: font.md, fontWeight: '700', color: colors.text },
  meta: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
});
