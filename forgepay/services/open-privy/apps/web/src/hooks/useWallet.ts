import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ethers } from 'ethers';

interface Wallet {
  id: string;
  address: string;
  chain: string;
  createdAt: string;
}

export const useWallet = () => {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [balance, setBalance] = useState<string>('0');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createWallet = async (chain: string = 'ethereum') => {
    setLoading(true);
    setError(null);

    try {
      const { data } = await api.post('/wallet/create', { chain });
      setWallet(data);
      await fetchBalance(data.id);
      return data;
    } catch (err: any) {
      const message = err.response?.data?.message || err.message;
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const fetchWallet = async (chain?: string) => {
    setLoading(true);
    try {
      const params = chain ? { chain } : {};
      const { data } = await api.get('/wallet/get', { params });
      if (data.address) {
        setWallet(data);
        await fetchBalance(data.id);
      }
    } catch (err: any) {
      const message = err.response?.data?.message || err.message;
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const fetchBalance = async (walletId: string) => {
    try {
      const { data } = await api.get(`/wallet/${walletId}/balance`);
      setBalance(data.balance);
    } catch (err) {
      console.error('Failed to fetch balance:', err);
    }
  };

  const listWallets = async () => {
    try {
      const { data } = await api.get('/wallet/list');
      return data;
    } catch (err: any) {
      console.error('Failed to list wallets:', err);
      return [];
    }
  };

  useEffect(() => {
    fetchWallet();
  }, []);

  return {
    wallet,
    balance,
    loading,
    error,
    createWallet,
    fetchWallet,
    fetchBalance,
    listWallets,
  };
};
