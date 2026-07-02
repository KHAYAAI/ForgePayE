import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuthStore } from './store/authStore';

import LoginScreen from './screens/LoginScreen';
import SignupScreen from './screens/SignupScreen';
import WalletScreen from './screens/WalletScreen';
import SendScreen from './screens/SendScreen';
import SettingsScreen from './screens/SettingsScreen';
import SplashScreen from './screens/SplashScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function WalletTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: true,
        tabBarActiveTintColor: '#7c3aed',
        tabBarInactiveTintColor: '#d1d5db',
      }}
    >
      <Tab.Screen
        name="WalletTab"
        component={WalletScreen}
        options={{
          title: 'Wallet',
          tabBarLabel: 'Wallet',
        }}
      />
      <Tab.Screen
        name="SendTab"
        component={SendScreen}
        options={{
          title: 'Send',
          tabBarLabel: 'Send',
        }}
      />
      <Tab.Screen
        name="SettingsTab"
        component={SettingsScreen}
        options={{
          title: 'Settings',
          tabBarLabel: 'Settings',
        }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const { user, initializeAuth } = useAuthStore();

  useEffect(() => {
    const bootstrap = async () => {
      try {
        await initializeAuth();
      } catch (e) {
        console.error('Failed to initialize auth:', e);
      } finally {
        setIsLoading(false);
      }
    };

    bootstrap();
  }, []);

  if (isLoading) {
    return <SplashScreen />;
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
        }}
      >
        {user ? (
          <Stack.Screen name="Wallet" component={WalletTabs} />
        ) : (
          <Stack.Group screenOptions={{ animationEnabled: false }}>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Signup" component={SignupScreen} />
          </Stack.Group>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
