import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Dimensions,
  Platform,
  StatusBar,
  AppState,
} from 'react-native';
import { Slot, useRouter, usePathname } from 'expo-router';
import { ensureForegroundNotificationHandler, requestNotificationPermission } from '../lib/mobileNotifications';

const SCREEN_WIDTH = Dimensions.get('window').width;
const DRAWER_WIDTH = Math.min(280, SCREEN_WIDTH * 0.75);

const MENU_ITEMS = [
  { label: '🧑‍🦰  Customer Page', route: '/', key: 'index' },
  { label: '💈  Barber Dashboard', route: '/dashboard', key: 'dashboard' },
  { label: '🔑  Admin Panel', route: '/admin', key: 'admin' },
];

function getPageTitle(pathname: string): string {
  if (pathname === '/dashboard') return 'Barber Dashboard';
  if (pathname === '/admin') return 'Admin Panel';
  return 'Quevix – Queue';
}

export default function Layout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const slideAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    console.log('[FCM] App layout mounted, setting up message handlers...');
    ensureForegroundNotificationHandler();
    requestNotificationPermission();

    // Re-check permission when user returns from settings
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        requestNotificationPermission();
      }
    });
    return () => sub.remove();
  }, []);

  const openDrawer = () => {
    setDrawerOpen(true);
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(overlayAnim, {
        toValue: 0.5,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const closeDrawer = () => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: -DRAWER_WIDTH,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(overlayAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => setDrawerOpen(false));
  };

  const navigateTo = (route: string) => {
    closeDrawer();
    setTimeout(() => {
      router.push(route as any);
    }, 100);
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1A1A2E" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={openDrawer} style={styles.hamburger}>
          <Text style={styles.hamburgerIcon}>☰</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{getPageTitle(pathname)}</Text>
        <View style={styles.headerRight} />
      </View>

      {/* Page Content */}
      <View style={styles.content}>
        <Slot />
      </View>

      {/* Drawer Overlay */}
      {drawerOpen && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={closeDrawer}
          >
            <Animated.View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: '#000', opacity: overlayAnim },
              ]}
            />
          </TouchableOpacity>

          <Animated.View
            style={[
              styles.drawer,
              { transform: [{ translateX: slideAnim }] },
            ]}
          >
            {/* Drawer Header */}
            <View style={styles.drawerHeader}>
              <Text style={styles.drawerLogo}>💈</Text>
              <Text style={styles.drawerTitle}>Quevix</Text>
              <Text style={styles.drawerSubtitle}>Smart Queue Platform</Text>
            </View>

            {/* Menu Items */}
            <View style={styles.drawerMenu}>
              {MENU_ITEMS.map((item) => {
                const isActive = pathname === item.route || (item.route === '/' && pathname === '');
                return (
                  <TouchableOpacity
                    key={item.key}
                    style={[styles.menuItem, isActive && styles.menuItemActive]}
                    onPress={() => navigateTo(item.route)}
                  >
                    <Text style={[styles.menuLabel, isActive && styles.menuLabelActive]}>
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Drawer Footer */}
            <View style={styles.drawerFooter}>
              <Text style={styles.footerText}>v1.0.0</Text>
            </View>
          </Animated.View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D1A',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A2E',
    paddingTop: Platform.OS === 'ios' ? 50 : 12,
    paddingBottom: 12,
    paddingHorizontal: 16,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  hamburger: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hamburgerIcon: {
    fontSize: 24,
    color: '#fff',
  },
  headerTitle: {
    flex: 1,
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  headerRight: {
    width: 44,
  },
  content: {
    flex: 1,
  },
  drawer: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: DRAWER_WIDTH,
    backgroundColor: '#1A1A2E',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    zIndex: 100,
  },
  drawerHeader: {
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 24,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
  },
  drawerLogo: {
    fontSize: 40,
    marginBottom: 8,
  },
  drawerTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 1,
  },
  drawerSubtitle: {
    color: '#6C757D',
    fontSize: 13,
    marginTop: 4,
  },
  drawerMenu: {
    flex: 1,
    paddingTop: 16,
    paddingHorizontal: 12,
  },
  menuItem: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginBottom: 4,
  },
  menuItemActive: {
    backgroundColor: 'rgba(0,123,255,0.15)',
  },
  menuLabel: {
    color: '#ADB5BD',
    fontSize: 16,
    fontWeight: '600',
  },
  menuLabelActive: {
    color: '#007BFF',
  },
  drawerFooter: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
  },
  footerText: {
    color: '#6C757D',
    fontSize: 12,
  },
});
