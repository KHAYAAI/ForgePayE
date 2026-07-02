import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import * as SplashScreen from 'expo-splash-screen';

SplashScreen.preventAutoHideAsync();

export default function SplashScreenComponent() {
  useEffect(() => {
    const hideSplash = async () => {
      await SplashScreen.hideAsync();
    };

    const timer = setTimeout(hideSplash, 1500);

    return () => clearTimeout(timer);
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.logo}>🔐</Text>
        <Text style={styles.title}>OpenPrivy</Text>
        <Text style={styles.subtitle}>Your Web3 Wallet. No Seed Phrases.</Text>

        <View style={styles.loaderContainer}>
          <ActivityIndicator size="large" color="#7c3aed" />
        </View>

        <Text style={styles.footerText}>Initializing wallet...</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#7c3aed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
  },
  logo: {
    fontSize: 64,
    marginBottom: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#f3f4f6',
    marginBottom: 48,
    textAlign: 'center',
  },
  loaderContainer: {
    marginVertical: 32,
  },
  footerText: {
    fontSize: 14,
    color: '#f3f4f6',
    marginTop: 24,
  },
});
