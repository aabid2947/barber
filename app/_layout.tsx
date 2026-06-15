import React, { useEffect } from 'react';
import { AppState } from 'react-native';
import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { ensureForegroundNotificationHandler, requestNotificationPermission } from '../lib/mobileNotifications';
import { FloatingTabBar } from '../src/components/FloatingTabBar';
import { palette } from '../src/theme/tokens';

export default function Layout() {
  // SafeAreaProvider must wrap the tree so useSafeAreaInsets works in every screen.
  // KeyboardProvider sits inside it and powers the smooth native keyboard-avoidance used
  // by KeyboardAwareScrollView in each screen. GestureHandlerRootView is required by the
  // navigator + pressable micro-interactions.
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: palette.canvas }}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <LayoutInner />
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function LayoutInner() {
  // FCM lifecycle — unchanged from the previous shell. Foreground handler + a permission
  // request on mount, re-checked whenever the app returns to the foreground (e.g. after the
  // user toggles the permission in system settings).
  useEffect(() => {
    console.log('[FCM] App layout mounted, setting up message handlers...');
    ensureForegroundNotificationHandler();
    requestNotificationPermission();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        requestNotificationPermission();
      }
    });
    return () => sub.remove();
  }, []);

  return (
    <>
      {/* Dark icons over the stark-white Workbench canvas. */}
      <StatusBar style="dark" />
      <Tabs
        tabBar={(props) => <FloatingTabBar {...props} />}
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: palette.canvas },
        }}
      >
        <Tabs.Screen name="index" options={{ title: 'Customer' }} />
        <Tabs.Screen name="dashboard" options={{ title: 'Barber' }} />
        <Tabs.Screen name="admin" options={{ title: 'Admin' }} />
      </Tabs>
    </>
  );
}
