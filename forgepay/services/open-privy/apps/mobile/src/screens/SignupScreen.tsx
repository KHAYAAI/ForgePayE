import React, { useState } from 'react';
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
} from 'react-native';
import { useAuthStore } from '../store/authStore';

export default function SignupScreen({ navigation }: any) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [username, setUsername] = useState('');
  const [passwordsMatch, setPasswordsMatch] = useState(true);
  const { signup, loading, error } = useAuthStore();

  const handlePasswordChange = (text: string) => {
    setPassword(text);
    setPasswordsMatch(text === confirmPassword);
  };

  const handleConfirmPasswordChange = (text: string) => {
    setConfirmPassword(text);
    setPasswordsMatch(password === text);
  };

  const handleSignup = async () => {
    if (!passwordsMatch) {
      return;
    }

    try {
      await signup(email, password, username);
      navigation.replace('Wallet');
    } catch (err) {
      console.error('Signup failed:', err);
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
            <Text style={styles.title}>Create Account</Text>
            <Text style={styles.subtitle}>Join OpenPrivy today</Text>
          </View>

          {error && <Text style={styles.error}>{error}</Text>}

          <View style={styles.form}>
            <TextInput
              style={styles.input}
              placeholder="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              editable={!loading}
            />

            <TextInput
              style={styles.input}
              placeholder="Username (optional)"
              value={username}
              onChangeText={setUsername}
              editable={!loading}
            />

            <TextInput
              style={styles.input}
              placeholder="Password"
              value={password}
              onChangeText={handlePasswordChange}
              secureTextEntry
              editable={!loading}
            />

            <TextInput
              style={[
                styles.input,
                !passwordsMatch && styles.inputError,
              ]}
              placeholder="Confirm Password"
              value={confirmPassword}
              onChangeText={handleConfirmPasswordChange}
              secureTextEntry
              editable={!loading}
            />

            {!passwordsMatch && (
              <Text style={styles.passwordErrorText}>Passwords do not match</Text>
            )}

            <TouchableOpacity
              style={[
                styles.button,
                (loading || !passwordsMatch) && styles.buttonDisabled,
              ]}
              onPress={handleSignup}
              disabled={loading || !passwordsMatch}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Create Account</Text>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account? </Text>
            <TouchableOpacity onPress={() => navigation.navigate('Login')}>
              <Text style={styles.link}>Sign in</Text>
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
    padding: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 30,
    marginTop: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  subtitle: {
    fontSize: 16,
    color: '#6b7280',
    marginTop: 8,
  },
  error: {
    color: '#dc2626',
    marginBottom: 16,
    textAlign: 'center',
    padding: 12,
    backgroundColor: '#fee2e2',
    borderRadius: 8,
  },
  form: {
    marginBottom: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  inputError: {
    borderColor: '#dc2626',
  },
  passwordErrorText: {
    color: '#dc2626',
    fontSize: 12,
    marginBottom: 12,
    marginTop: -8,
  },
  button: {
    backgroundColor: '#7c3aed',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    backgroundColor: '#9ca3af',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 40,
  },
  footerText: {
    color: '#6b7280',
  },
  link: {
    color: '#7c3aed',
    fontWeight: '600',
  },
});
