import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import RecuperarGate from '../components/RecuperarGate';
import SyncManager from '../components/SyncManager';
import { DB_NAME, migrateDbIfNeeded } from '../db';
import { colors } from '../theme/tokens';

export default function RootLayout() {
  return (
    <SQLiteProvider
      databaseName={DB_NAME}
      onInit={migrateDbIfNeeded}
      options={{ enableChangeListener: true }}
    >
      <SyncManager />
      <RecuperarGate />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTitleStyle: { color: colors.text },
          headerTintColor: colors.primary,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="transaccion/[tipo]"
          options={{ presentation: 'modal', title: 'Operación' }}
        />
        <Stack.Screen
          name="salida"
          options={{ presentation: 'modal', title: 'Salida sin venta' }}
        />
        <Stack.Screen
          name="transporte"
          options={{ presentation: 'modal', title: 'Costo de transporte' }}
        />
        <Stack.Screen
          name="cambio"
          options={{ presentation: 'modal', title: 'Cambio / Devolución' }}
        />
        <Stack.Screen name="producto/nuevo" options={{ title: 'Nuevo producto' }} />
        <Stack.Screen name="producto/[barcode]" options={{ title: 'Producto' }} />
        <Stack.Screen name="carga-inicial" options={{ title: 'Carga inicial' }} />
        <Stack.Screen name="conteo" options={{ title: 'Chequeo de inventario' }} />
        <Stack.Screen name="faltantes" options={{ title: 'Faltantes' }} />
        <Stack.Screen name="detalle/[id]" options={{ title: 'Detalle' }} />
        <Stack.Screen name="anular" options={{ title: 'Anular movimiento' }} />
      </Stack>
      <StatusBar style="auto" />
    </SQLiteProvider>
  );
}
