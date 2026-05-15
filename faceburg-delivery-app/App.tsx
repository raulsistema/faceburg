import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  finishDelivery,
  listDeliveryOrders,
  loginDeliveryDriver,
  lookupDeliveryOrder,
  startDelivery,
} from '@/services/api';
import { startDeliveryTracking, stopDeliveryTracking } from '@/services/locationTask';
import { getDeviceId } from '@/services/routeStore';
import type { DeliveryOrder } from '@/types';

function formatMoney(value: number) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function statusLabel(status: string) {
  if (status === 'processing') return 'Cozinha';
  if (status === 'delivering') return 'Em entrega';
  if (status === 'completed') return 'Entregue';
  if (status === 'pending') return 'Novo';
  return status || 'Pedido';
}

function mapsUrl(address: string) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}

export default function App() {
  const [tenantSlug, setTenantSlug] = useState('');
  const [pin, setPin] = useState('');
  const [driverName, setDriverName] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [authName, setAuthName] = useState('');
  const [code, setCode] = useState('');
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [activeOrder, setActiveOrder] = useState<DeliveryOrder | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const activeOrderTitle = useMemo(() => {
    if (!activeOrder) return 'Nenhuma entrega ativa';
    return `#${activeOrder.code || activeOrder.id.slice(0, 8).toUpperCase()} - ${activeOrder.customerName}`;
  }, [activeOrder]);

  const loadOrders = useCallback(async () => {
    if (!authenticated) return;
    setLoading(true);
    try {
      setOrders(await listDeliveryOrders());
    } catch (error) {
      Alert.alert('Entregas', error instanceof Error ? error.message : 'Falha ao carregar entregas.');
    } finally {
      setLoading(false);
    }
  }, [authenticated]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  async function handleLogin() {
    if (!tenantSlug.trim() || !pin.trim()) {
      Alert.alert('Login', 'Informe loja e PIN.');
      return;
    }

    setLoading(true);
    try {
      const deviceId = await getDeviceId();
      const result = await loginDeliveryDriver({
        tenantSlug: tenantSlug.trim(),
        pin: pin.trim(),
        driverName: driverName.trim() || 'Motoboy',
        deviceId,
      });
      setAuthName(result.driver.name);
      setAuthenticated(true);
    } catch (error) {
      Alert.alert('Login', error instanceof Error ? error.message : 'Falha ao autenticar.');
    } finally {
      setLoading(false);
    }
  }

  async function handleLookup() {
    if (!code.trim()) return;
    setLoading(true);
    try {
      const order = await lookupDeliveryOrder(code.trim());
      setActiveOrder(order);
    } catch (error) {
      Alert.alert('Pedido', error instanceof Error ? error.message : 'Pedido nao encontrado.');
    } finally {
      setLoading(false);
    }
  }

  async function handleStart(order: DeliveryOrder) {
    setActionLoading(true);
    try {
      const updated = await startDelivery(order.id);
      const next = { ...order, ...updated, status: updated.status || 'delivering' } as DeliveryOrder;
      setActiveOrder(next);
      await startDeliveryTracking(order.id);
      void loadOrders();
    } catch (error) {
      Alert.alert('Entrega', error instanceof Error ? error.message : 'Falha ao iniciar entrega.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleFinish() {
    if (!activeOrder) return;
    setActionLoading(true);
    try {
      const updated = await finishDelivery(activeOrder.id);
      setActiveOrder({ ...activeOrder, ...updated, status: updated.status || 'completed' } as DeliveryOrder);
      await stopDeliveryTracking();
      void loadOrders();
    } catch (error) {
      Alert.alert('Entrega', error instanceof Error ? error.message : 'Falha ao finalizar entrega.');
    } finally {
      setActionLoading(false);
    }
  }

  if (!authenticated) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.loginPanel}>
          <Text style={styles.kicker}>Faceburg</Text>
          <Text style={styles.title}>Entregador</Text>
          <TextInput
            value={tenantSlug}
            onChangeText={setTenantSlug}
            placeholder="slug da loja"
            autoCapitalize="none"
            style={styles.input}
            placeholderTextColor="#94a3b8"
          />
          <TextInput
            value={driverName}
            onChangeText={setDriverName}
            placeholder="nome do motoboy"
            style={styles.input}
            placeholderTextColor="#94a3b8"
          />
          <TextInput
            value={pin}
            onChangeText={setPin}
            placeholder="PIN"
            secureTextEntry
            keyboardType="number-pad"
            style={styles.input}
            placeholderTextColor="#94a3b8"
          />
          <Pressable style={styles.primaryButton} onPress={handleLogin} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Entrar</Text>}
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>Motoboy</Text>
            <Text style={styles.title}>{authName || 'Entregador'}</Text>
          </View>
          <Pressable style={styles.secondaryButton} onPress={loadOrders} disabled={loading}>
            <Text style={styles.secondaryButtonText}>{loading ? '...' : 'Atualizar'}</Text>
          </Pressable>
        </View>

        <View style={styles.searchRow}>
          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder="codigo do pedido"
            autoCapitalize="characters"
            style={[styles.input, styles.searchInput]}
            placeholderTextColor="#94a3b8"
          />
          <Pressable style={styles.squareButton} onPress={handleLookup} disabled={loading}>
            <Text style={styles.squareButtonText}>OK</Text>
          </Pressable>
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>{activeOrderTitle}</Text>
          {activeOrder ? (
            <>
              <Text style={styles.status}>{statusLabel(activeOrder.status)}</Text>
              <Text style={styles.bodyText}>{activeOrder.deliveryAddress || 'Endereco nao informado'}</Text>
              <Text style={styles.bodyText}>{activeOrder.customerPhone || 'Telefone nao informado'}</Text>
              <Text style={styles.total}>{formatMoney(activeOrder.total)}</Text>

              <View style={styles.actions}>
                <Pressable
                  style={[styles.primaryButton, activeOrder.status === 'delivering' || actionLoading ? styles.disabled : null]}
                  onPress={() => handleStart(activeOrder)}
                  disabled={activeOrder.status === 'delivering' || actionLoading}
                >
                  <Text style={styles.primaryButtonText}>Iniciar entrega</Text>
                </Pressable>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => activeOrder.deliveryAddress ? Linking.openURL(mapsUrl(activeOrder.deliveryAddress)) : undefined}
                >
                  <Text style={styles.secondaryButtonText}>Google Maps</Text>
                </Pressable>
                <Pressable
                  style={[styles.darkButton, activeOrder.status !== 'delivering' || actionLoading ? styles.disabled : null]}
                  onPress={handleFinish}
                  disabled={activeOrder.status !== 'delivering' || actionLoading}
                >
                  <Text style={styles.darkButtonText}>Finalizar</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <Text style={styles.bodyText}>Selecione uma entrega ou busque pelo codigo.</Text>
          )}
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Disponiveis</Text>
          <FlatList
            scrollEnabled={false}
            data={orders}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <Pressable style={styles.orderRow} onPress={() => setActiveOrder(item)}>
                <View>
                  <Text style={styles.orderCode}>#{item.code}</Text>
                  <Text style={styles.orderName}>{item.customerName}</Text>
                  <Text style={styles.orderAddress} numberOfLines={1}>{item.deliveryAddress}</Text>
                </View>
                <Text style={styles.status}>{statusLabel(item.status)}</Text>
              </Pressable>
            )}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  content: {
    padding: 18,
    gap: 14,
  },
  loginPanel: {
    flex: 1,
    justifyContent: 'center',
    padding: 22,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  kicker: {
    color: '#059669',
    fontWeight: '800',
    fontSize: 13,
  },
  title: {
    color: '#0f172a',
    fontWeight: '900',
    fontSize: 28,
  },
  input: {
    height: 46,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingHorizontal: 14,
    color: '#0f172a',
    fontWeight: '700',
  },
  searchRow: {
    flexDirection: 'row',
    gap: 8,
  },
  searchInput: {
    flex: 1,
  },
  panel: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    padding: 14,
    gap: 10,
  },
  panelTitle: {
    color: '#0f172a',
    fontWeight: '900',
    fontSize: 18,
  },
  bodyText: {
    color: '#475569',
    fontSize: 14,
    lineHeight: 20,
  },
  total: {
    color: '#0f172a',
    fontSize: 20,
    fontWeight: '900',
  },
  status: {
    color: '#047857',
    fontWeight: '900',
    fontSize: 12,
  },
  actions: {
    gap: 8,
  },
  primaryButton: {
    minHeight: 46,
    borderRadius: 8,
    backgroundColor: '#059669',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '900',
  },
  secondaryButton: {
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  secondaryButtonText: {
    color: '#0f172a',
    fontWeight: '900',
  },
  darkButton: {
    minHeight: 46,
    borderRadius: 8,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  darkButtonText: {
    color: '#fff',
    fontWeight: '900',
  },
  squareButton: {
    width: 52,
    height: 46,
    borderRadius: 8,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  squareButtonText: {
    color: '#fff',
    fontWeight: '900',
  },
  disabled: {
    opacity: 0.45,
  },
  orderRow: {
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  orderCode: {
    color: '#94a3b8',
    fontWeight: '900',
    fontSize: 12,
  },
  orderName: {
    color: '#0f172a',
    fontWeight: '900',
  },
  orderAddress: {
    color: '#64748b',
    maxWidth: 230,
  },
});
