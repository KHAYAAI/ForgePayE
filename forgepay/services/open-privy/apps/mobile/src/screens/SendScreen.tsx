import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import { useAuthStore } from '../store/authStore';
import { api } from '../lib/api';

interface SendFormData {
  recipientAddress: string;
  amount: string;
  chain: string;
}

export default function SendScreen({ navigation }: any) {
  const [formData, setFormData] = useState<SendFormData>({
    recipientAddress: '',
    amount: '',
    chain: 'ethereum',
  });
  const [loading, setLoading] = useState(false);
  const [estimatedGas, setEstimatedGas] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuthStore();

  const handleInputChange = (field: keyof SendFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setError(null);
  };

  const validateForm = () => {
    if (!formData.recipientAddress.trim()) {
      setError('Recipient address is required');
      return false;
    }

    if (!formData.amount.trim()) {
      setError('Amount is required');
      return false;
    }

    const amount = parseFloat(formData.amount);
    if (isNaN(amount) || amount <= 0) {
      setError('Amount must be a positive number');
      return false;
    }

    return true;
  };

  const estimateGasCost = async () => {
    if (!validateForm()) return;

    setLoading(true);
    try {
      const { data } = await api.post('/account-abstraction/estimate-gas', {
        recipientAddress: formData.recipientAddress,
        amount: formData.amount,
        chain: formData.chain,
      });
      setEstimatedGas(data.estimatedGas);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to estimate gas');
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (!validateForm()) return;

    Alert.alert(
      'Confirm Transaction',
      `Send ${formData.amount} ETH to ${formData.recipientAddress.substring(0, 10)}...?`,
      [
        {
          text: 'Cancel',
          onPress: () => {},
        },
        {
          text: 'Send',
          onPress: async () => {
            await sendTransaction();
          },
        },
      ],
    );
  };

  const sendTransaction = async () => {
    setLoading(true);
    setError(null);

    try {
      const { data } = await api.post('/account-abstraction/send-userop', {
        recipientAddress: formData.recipientAddress,
        amount: formData.amount,
        chain: formData.chain,
      });

      Alert.alert(
        'Transaction Sent',
        `Transaction hash: ${data.userOpHash}`,
        [
          {
            text: 'OK',
            onPress: () => {
              navigation.goBack();
            },
          },
        ],
      );
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to send transaction');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.content}
      >
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()}>
              <Text style={styles.backButton}>← Back</Text>
            </TouchableOpacity>
            <Text style={styles.title}>Send Funds</Text>
          </View>

          {error && <Text style={styles.error}>{error}</Text>}

          <View style={styles.form}>
            <View style={styles.formGroup}>
              <Text style={styles.label}>Recipient Address</Text>
              <TextInput
                style={styles.input}
                placeholder="0x..."
                value={formData.recipientAddress}
                onChangeText={(value) => handleInputChange('recipientAddress', value)}
                editable={!loading}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Amount (ETH)</Text>
              <TextInput
                style={styles.input}
                placeholder="0.0"
                value={formData.amount}
                onChangeText={(value) => handleInputChange('amount', value)}
                keyboardType="decimal-pad"
                editable={!loading}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Network</Text>
              <View style={styles.chainSelector}>
                {['ethereum', 'polygon', 'solana'].map((chain) => (
                  <TouchableOpacity
                    key={chain}
                    style={[
                      styles.chainButton,
                      formData.chain === chain && styles.chainButtonActive,
                    ]}
                    onPress={() => handleInputChange('chain', chain)}
                  >
                    <Text
                      style={[
                        styles.chainButtonText,
                        formData.chain === chain && styles.chainButtonTextActive,
                      ]}
                    >
                      {chain.charAt(0).toUpperCase() + chain.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {estimatedGas && (
              <View style={styles.gasInfo}>
                <Text style={styles.gasLabel}>Estimated Gas Cost</Text>
                <Text style={styles.gasValue}>${estimatedGas}</Text>
                <Text style={styles.gasSponsor}>Sponsored by OpenPrivy ✨</Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.button, styles.estimateButton, loading && styles.buttonDisabled]}
              onPress={estimateGasCost}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#7c3aed" />
              ) : (
                <Text style={styles.estimateButtonText}>Estimate Gas</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.sendButton, loading && styles.buttonDisabled]}
              onPress={handleSend}
              disabled={loading || !estimatedGas}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.sendButtonText}>Send Funds</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  content: {
    flex: 1,
  },
  header: {
    padding: 20,
    backgroundColor: '#7c3aed',
  },
  backButton: {
    color: '#fff',
    fontSize: 16,
    marginBottom: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  error: {
    margin: 16,
    padding: 12,
    backgroundColor: '#fee2e2',
    color: '#dc2626',
    borderRadius: 8,
    fontSize: 14,
  },
  form: {
    padding: 16,
  },
  formGroup: {
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  chainSelector: {
    flexDirection: 'row',
    gap: 8,
  },
  chainButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  chainButtonActive: {
    backgroundColor: '#7c3aed',
    borderColor: '#7c3aed',
  },
  chainButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
  },
  chainButtonTextActive: {
    color: '#fff',
  },
  gasInfo: {
    padding: 12,
    backgroundColor: '#f0f9ff',
    borderRadius: 8,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#0284c7',
  },
  gasLabel: {
    fontSize: 12,
    color: '#0c4a6e',
    marginBottom: 4,
  },
  gasValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#0284c7',
    marginBottom: 4,
  },
  gasSponsor: {
    fontSize: 12,
    color: '#0c4a6e',
  },
  button: {
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  estimateButton: {
    backgroundColor: '#f3f4f6',
  },
  estimateButtonText: {
    color: '#7c3aed',
    fontSize: 16,
    fontWeight: '600',
  },
  sendButton: {
    backgroundColor: '#7c3aed',
  },
  sendButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
