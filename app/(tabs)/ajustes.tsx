import { Ionicons } from '@expo/vector-icons';
import { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { User } from 'firebase/auth';
import { Button, Card, Input, Screen } from '../../components/ui';
import {
  getConteoMuestra,
  getMargenGeneral,
  getSalarioPct,
  setConfig,
} from '../../db/configuracion';
import {
  cerrarSesion,
  huellaConfigurada,
  huellaDisponible,
  iniciarSesion,
  iniciarSesionConHuella,
  olvidarHuella,
  onCambioSesion,
  recordarHuella,
  usuarioActual,
} from '../../lib/auth';
import {
  estadoRespaldo,
  marcarTodoPendienteRespaldo,
  respaldar,
  restaurar,
  vaciarRespaldoRemoto,
} from '../../lib/backup';
import { vaciarDatosLocales } from '../../db/mantenimiento';
import { toast } from '../../lib/feedback';
import { colors, font, spacing } from '../../theme/tokens';

function fechaLegible(iso: string | null): string {
  if (!iso) return 'Nunca';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'Nunca' : d.toLocaleString('es-CO');
}

function mensajeError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  if (
    code.includes('invalid-credential') ||
    code.includes('wrong-password') ||
    code.includes('user-not-found')
  ) {
    return 'Correo o contraseña incorrectos.';
  }
  if (code.includes('network')) return 'Sin conexión. Revisa tu internet.';
  return (e as Error)?.message ?? 'Error desconocido.';
}

export default function AjustesScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [margen, setMargen] = useState('');
  const [salario, setSalario] = useState('');
  const [muestra, setMuestra] = useState('');
  const [pctAbierto, setPctAbierto] = useState(false);

  // --- Respaldo ---
  const [usuario, setUsuario] = useState<User | null>(usuarioActual());
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [cargando, setCargando] = useState(false);
  const [respaldando, setRespaldando] = useState(false);
  const [reconstruyendo, setReconstruyendo] = useState(false);
  const [huellaDisp, setHuellaDisp] = useState(false);
  const [huellaConf, setHuellaConf] = useState(false);
  const [ultimo, setUltimo] = useState<string | null>(null);
  const [pendientes, setPendientes] = useState(0);
  const [restaurando, setRestaurando] = useState(false);
  const [vaciando, setVaciando] = useState(false);
  const [vaciandoTodo, setVaciandoTodo] = useState(false);
  // Guarda la contraseña de la sesión actual para poder activar la huella
  // sin volver a pedirla. Se limpia al cerrar sesión.
  const pwRef = useRef<string | null>(null);

  const refrescar = useCallback(async () => {
    const u = usuarioActual();
    setUsuario(u);
    setHuellaDisp(await huellaDisponible());
    setHuellaConf(await huellaConfigurada());
    if (u) {
      const e = await estadoRespaldo(db);
      setUltimo(e.ultimoRespaldo);
      setPendientes(e.pendientes);
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      getMargenGeneral(db).then((m) => setMargen(String(m)));
      getSalarioPct(db).then((s) => setSalario(String(s)));
      getConteoMuestra(db).then((n) => setMuestra(String(n)));
      refrescar();
      return onCambioSesion(() => refrescar());
    }, [db, refrescar])
  );

  const guardarPorcentajes = async () => {
    const m = Number(margen);
    const s = Number(salario);
    if (!Number.isFinite(m) || m < 0) {
      Alert.alert('Margen inválido', 'Ingresa un porcentaje válido.');
      return;
    }
    if (!Number.isFinite(s) || s < 0) {
      Alert.alert('Salario inválido', 'Ingresa un porcentaje válido.');
      return;
    }
    const n = Number(muestra);
    if (!Number.isFinite(n) || n < 1) {
      Alert.alert('Muestra inválida', 'Ingresa cuántos productos contar (≥ 1).');
      return;
    }
    await setConfig(db, 'margen_general_pct', String(m));
    await setConfig(db, 'salario_pct', String(s));
    await setConfig(db, 'conteo_muestra', String(Math.round(n)));
    toast('Ajustes guardados');
  };

  const login = async () => {
    if (!email.trim() || !password) {
      Alert.alert('Datos incompletos', 'Ingresa correo y contraseña.');
      return;
    }
    setCargando(true);
    try {
      await iniciarSesion(email, password);
      pwRef.current = password;
      setPassword('');
      await refrescar();
      toast('Sesión iniciada');
      if ((await huellaDisponible()) && !(await huellaConfigurada())) {
        Alert.alert(
          'Ingreso con huella',
          '¿Activar el ingreso con huella en este equipo para la próxima vez?',
          [
            { text: 'Ahora no', style: 'cancel' },
            { text: 'Activar', onPress: activarHuella },
          ]
        );
      }
    } catch (e) {
      Alert.alert('No se pudo iniciar sesión', mensajeError(e));
    } finally {
      setCargando(false);
    }
  };

  const loginHuella = async () => {
    setCargando(true);
    try {
      const ok = await iniciarSesionConHuella();
      if (!ok) {
        toast('Usa tu contraseña');
      } else {
        await refrescar();
        toast('Sesión iniciada');
      }
    } catch (e) {
      Alert.alert('No se pudo iniciar sesión', mensajeError(e));
    } finally {
      setCargando(false);
    }
  };

  const respaldarAhora = async () => {
    setRespaldando(true);
    try {
      const n = await respaldar(db);
      await refrescar();
      toast(
        n > 0 ? `Respaldo completo (${n} cambios)` : 'Todo ya estaba respaldado'
      );
    } catch (e) {
      Alert.alert('No se pudo respaldar', mensajeError(e));
    } finally {
      setRespaldando(false);
    }
  };

  const reconstruirRespaldo = () => {
    Alert.alert(
      'Reconstruir respaldo completo',
      'Esto volvera a marcar todos los productos, transacciones e items locales como pendientes para subirlos otra vez a Firestore. Usalo solo si borraste colecciones en la nube por error.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Reconstruir',
          onPress: async () => {
            setReconstruyendo(true);
            try {
              const pendientesMarcados = await marcarTodoPendienteRespaldo(db);
              const n = await respaldar(db);
              await refrescar();
              toast(
                n > 0
                  ? `Respaldo reconstruido (${n} registros; ${pendientesMarcados} marcados)`
                  : 'No habia registros para reconstruir'
              );
            } catch (e) {
              Alert.alert('No se pudo reconstruir', mensajeError(e));
            } finally {
              setReconstruyendo(false);
            }
          },
        },
      ]
    );
  };

  const restaurarDesdeNube = () => {
    Alert.alert(
      'Restaurar desde la nube',
      'Descarga el respaldo de Firestore y reemplaza los datos locales. Los registros en el teléfono que no estén en la nube se conservan. ¿Continuar?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Restaurar',
          onPress: async () => {
            setRestaurando(true);
            try {
              const n = await restaurar(db);
              await refrescar();
              toast(`Restauración completa (${n} registros)`);
            } catch (e) {
              Alert.alert('No se pudo restaurar', mensajeError(e));
            } finally {
              setRestaurando(false);
            }
          },
        },
      ]
    );
  };

  const activarHuella = async () => {
    if (!pwRef.current) {
      Alert.alert(
        'Vuelve a iniciar sesión',
        'Cierra sesión e ingresa de nuevo para activar la huella.'
      );
      return;
    }
    await recordarHuella(usuario?.email ?? email, pwRef.current);
    await refrescar();
    toast('Huella activada');
  };

  const desactivarHuella = async () => {
    await olvidarHuella();
    await refrescar();
    toast('Huella desactivada');
  };

  const logout = async () => {
    await cerrarSesion();
    pwRef.current = null;
    await refrescar();
    toast('Sesión cerrada');
  };

  const vaciarBase = () => {
    Alert.alert(
      'Vaciar base de datos',
      'Esto borra todos los productos y movimientos guardados en este teléfono. No se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Vaciar',
          style: 'destructive',
          onPress: async () => {
            setVaciando(true);
            try {
              await vaciarDatosLocales(db);
              await refrescar();
              toast('Base de datos vaciada');
            } catch (e) {
              Alert.alert('No se pudo vaciar', mensajeError(e));
            } finally {
              setVaciando(false);
            }
          },
        },
      ]
    );
  };

  const vaciarLocalYNube = () => {
    Alert.alert(
      'Vaciar telefono y nube',
      'Esto borrara permanentemente los productos, movimientos y respaldo en Firestore. Primero se vaciara la nube y luego este telefono. No se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Vaciar todo',
          style: 'destructive',
          onPress: async () => {
            setVaciandoTodo(true);
            try {
              const borradosRemotos = await vaciarRespaldoRemoto();
              await vaciarDatosLocales(db);
              await setConfig(db, 'last_backup_at', '');
              await refrescar();
              toast(
                borradosRemotos > 0
                  ? `Telefono y nube vaciados (${borradosRemotos} docs remotos)`
                  : 'Telefono y nube vaciados'
              );
            } catch (e) {
              Alert.alert('No se pudo vaciar todo', mensajeError(e));
            } finally {
              setVaciandoTodo(false);
            }
          },
        },
      ]
    );
  };

  return (
    <Screen padded scroll>
      <Card style={{ gap: spacing.sm }}>
        <Pressable
          style={styles.pctHead}
          onPress={() => setPctAbierto((v) => !v)}
        >
          <View style={styles.head}>
            <Ionicons name="options-outline" size={20} color={colors.primary} />
            <Text style={styles.title}>Porcentajes</Text>
          </View>
          <Ionicons
            name={pctAbierto ? 'chevron-up' : 'chevron-down'}
            size={20}
            color={colors.textMuted}
          />
        </Pressable>
        {pctAbierto && (
          <>
            <Text style={styles.help}>
              Margen para sugerir precios (modo “calcular con margen”) y el
              porcentaje de tu salario mensual sobre el efectivo del mes
              (estimado o contado) más lo invertido en compras y transporte.
            </Text>
            <View style={styles.pctRow}>
              <View style={styles.pctCol}>
                <Input
                  label="Margen (%)"
                  keyboardType="numeric"
                  value={margen}
                  onChangeText={setMargen}
                />
              </View>
              <View style={styles.pctCol}>
                <Input
                  label="Salario (%)"
                  keyboardType="numeric"
                  value={salario}
                  onChangeText={setSalario}
                />
              </View>
            </View>
            <Input
              label="Productos a contar por mes"
              hint="Cuántos productos pide el chequeo de inventario cada mes (rotación)."
              keyboardType="numeric"
              value={muestra}
              onChangeText={setMuestra}
            />
            <Button label="Guardar" icon="save" onPress={guardarPorcentajes} />
          </>
        )}
      </Card>

      <Card style={[styles.respaldo, { gap: spacing.sm }]}>
        <View style={styles.head}>
          <Ionicons name="scan-outline" size={20} color={colors.primary} />
          <Text style={styles.title}>Carga inicial del catálogo</Text>
        </View>
        <Text style={styles.help}>
          Escanea toda la tienda para dar de alta los productos de una sola vez.
          Pensado para el primer arranque.
        </Text>
        <Button
          label="Iniciar carga"
          icon="scan"
          variant="secondary"
          onPress={() => router.push('/carga-inicial')}
        />
      </Card>

      <Card style={[styles.respaldo, { gap: spacing.sm }]}>
        <View style={styles.head}>
          <Ionicons
            name={usuario ? 'cloud-done-outline' : 'cloud-offline-outline'}
            size={20}
            color={usuario ? colors.venta : colors.textMuted}
          />
          <Text style={styles.title}>Respaldo</Text>
        </View>

        {usuario ? (
          <>
            <Text style={styles.help}>Cuenta: {usuario.email}</Text>
            <Text style={styles.help}>
              Último respaldo: {fechaLegible(ultimo)}
            </Text>
            <Text style={styles.help}>Cambios pendientes: {pendientes}</Text>
            <Button
              label="Respaldar ahora"
              icon="cloud-upload"
              loading={respaldando}
              onPress={respaldarAhora}
            />
            <Text style={styles.help}>
              Si borraste una coleccion en Firestore por error, usa la
              reconstruccion completa para volver a subir todo el respaldo desde
              este telefono.
            </Text>
            <Button
              label="Reconstruir respaldo completo"
              icon="refresh-circle"
              variant="secondary"
              loading={reconstruyendo}
              onPress={reconstruirRespaldo}
            />
            <Text style={styles.help}>
              Si se corrigieron datos directamente en la nube, usa este botón
              para traer esos cambios al teléfono.
            </Text>
            <Button
              label="Restaurar desde la nube"
              icon="cloud-download"
              variant="secondary"
              loading={restaurando}
              onPress={restaurarDesdeNube}
            />
            {huellaDisp &&
              (huellaConf ? (
                <Button
                  label="Desactivar huella"
                  icon="finger-print"
                  variant="secondary"
                  onPress={desactivarHuella}
                />
              ) : (
                <Button
                  label="Activar ingreso con huella"
                  icon="finger-print"
                  variant="secondary"
                  onPress={activarHuella}
                />
              ))}
            <Button
              label="Cerrar sesión"
              icon="log-out"
              variant="ghost"
              onPress={logout}
            />
          </>
        ) : (
          <>
            <Text style={styles.help}>
              Inicia sesión para activar el respaldo en la nube y poder
              recuperar tus datos si pierdes el teléfono.
            </Text>
            <Input
              label="Correo"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            <Input
              label="Contraseña"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
            <Button
              label="Iniciar sesión"
              icon="log-in"
              loading={cargando}
              onPress={login}
            />
            {huellaDisp && huellaConf && (
              <Button
                label="Entrar con huella"
                icon="finger-print"
                variant="secondary"
                onPress={loginHuella}
              />
            )}
          </>
        )}
      </Card>

      <Card style={[styles.respaldo, { gap: spacing.sm }]}>
        <View style={styles.head}>
          <Ionicons name="trash-outline" size={20} color={colors.danger} />
          <Text style={styles.title}>Zona de pruebas</Text>
        </View>
        <Text style={styles.help}>
          Borra productos y movimientos guardados en este teléfono. Útil
          antes y después de una prueba de campo.
          {usuario &&
            ' Tienes sesión iniciada: si hay internet, los datos podrían volver a sincronizarse solos desde el respaldo. Cierra sesión antes si quieres una base completamente vacía.'}
        </Text>
        <Button
          label="Vaciar base de datos"
          icon="trash"
          variant="danger"
          loading={vaciando}
          onPress={vaciarBase}
        />
        {usuario ? (
          <>
            <Text style={styles.help}>
              Si quieres un reinicio total de pruebas, este boton borra tambien
              el respaldo remoto de Firestore antes de vaciar el telefono.
            </Text>
            <Button
              label="Vaciar telefono y nube"
              icon="nuclear"
              variant="danger"
              loading={vaciandoTodo}
              onPress={vaciarLocalYNube}
            />
          </>
        ) : (
          <Text style={styles.help}>
            Inicia sesion para poder borrar tambien el respaldo remoto.
          </Text>
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  help: { fontSize: font.sm, color: colors.textMuted },
  respaldo: { marginTop: spacing.lg },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { fontSize: font.md, fontWeight: '700', color: colors.text },
  pctHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pctRow: { flexDirection: 'row', gap: spacing.sm },
  pctCol: { flex: 1 },
});
