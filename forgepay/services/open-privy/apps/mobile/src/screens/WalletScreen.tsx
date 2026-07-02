import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useAuthStore } from '../store/authStore';
import { api } from '../lib/api';

interface Wallet {
  id: string;
  address: string;
  chain: string;
  createdAt: string;
}

export default function WalletScreen({ navigation }: any) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [balance, setBalance] = useState<string>('0');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { user } = useAuthStore();

  const fetchWallet = async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/wallet/get');
      setWallet(data);

      if (data.id) {
        const balanceRes = await api.get(`/wallet/${data.id}/balance`);
        setBalance(balanceRes.data.balance);
      }
    } catch (error) {
      console.error('Failed to fetch wallet:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchWallet();
    setRefreshing(false);
  };

  useEffect(() => {
    fetchWallet();
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#7c3aed" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.header}>
          <Text style={styles.greeting}>Hello, {user?.email}</Text>
          <Text style={styles.subtitle}>Your Web3 Wallet</Text>
        </View>

        {wallet ? (
          <>
            <View style={styles.balanceCard}>
              <Text style={styles.balanceLabel}>Total Balance</Text>
              <Text style={styles.balanceAmount}>{balance} ETH</Text>
              <Text style={styles.address}>{wallet.address.substring(0, 10)}...</Text>
            </View>

            <View style={styles.actions}>
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => navigation.navigate('SendTab')}
              >
                <Text style={styles.actionIcon}>📤</Text>
                <Text style={styles.actionText}>Send</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.actionButton}>
                <Text style={styles.actionIcon}>📥</Text>
                <Text style={styles.actionText}>Receive</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.actionButton}>
                <Text style={styles.actionIcon}>💱</Text>
                <Text style={styles.actionText}>Swap</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.infoCard}>
              <Text style={styles.infoTitle}>Network</Text>
              <Text style={styles.infoValue}>{wallet.chain === 'ethereum' ? 'Ethereum (Sepolia)' : wallet.chain}</Text>
            </View>

            <View style={styles.infoCard}>
              <Text style={styles.infoTitle}>Security Status</Text>
              <Text style={styles.statusGood}>✅ Secure</Text>
            </View>
          </>
        ) : (
          <View style={styles.centered}>
            <Text style={styles.error}>No wallet found</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    padding: 20,
    backgroundColor: '#7c3aed',
  },
  greeting: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  subtitle: {
    fontSize: 14,
    color: '#f3f4f6',
    marginTop: 4,
  },
  balanceCard: {
    margin: 16,
    padding: 20,
    backgroundColor: '#fff',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  balanceLabel: {
    fontSize: 14,
    color: '#6b7280',
  },
  balanceAmount: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#7c3aed',
    marginVertical: 8,
  },
  address: {
    fontSize: 12,
    color: '#9ca3af',
    fontFamily: 'monospace',
  },
  actions: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 12,
  },
  actionButton: {
    flex: 1,
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  actionIcon: {
    fontSize: 24,
    marginBottom: 8,
  },
  actionText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1f2937',
  },
  infoCard: {
    margin: 16,
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
  },
  infoTitle: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
  },
  statusGood: {
    fontSize: 16,
    fontWeight: '600',
    color: '#059669',
  },
  error: {
    fontSize: 16,
    color: '#dc2626',
  },
});
