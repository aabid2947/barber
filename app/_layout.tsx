import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Dimensions,
  StatusBar,
  AppState,
} from 'react-native';
import { Slot, useRouter, usePathname } from 'expo-router';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { useFonts } from 'expo-font';
import { ensureForegroundNotificationHandler, requestNotificationPermission } from '../lib/mobileNotifications';
import { colors, fontFamilies, typography } from '../lib/theme';

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
  // Load the bundled SpaceMono ttf so fontFamilies.display resolves at runtime.
  // Until the font is ready we still render — the body text stays on system font and
  // the display text simply gets the system fallback, which is fine for the brief load.
  useFonts({
    'SpaceMono-Regular': require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  // SafeAreaProvider must wrap the tree so useSafeAreaInsets works in every screen.
  // KeyboardProvider sits inside the safe-area provider and powers the smooth
  // native keyboard-avoidance used by KeyboardAwareScrollView in each screen.
  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <LayoutInner />
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

function LayoutInner() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const slideAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;
  const router = useRouter();
  const pathname = usePathname();
  // insets.top -> status bar / notch / Dynamic Island.
  // insets.bottom -> Android 3-button nav bar / iOS home indicator.
  const insets = useSafeAreaInsets();

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
      {/* translucent so the dark header colour extends behind the status bar; insets.top
          gives us the exact pixels to push header content past the notch / status bar. */}
      <StatusBar barStyle="light-content" backgroundColor={colors.darkSurface} translucent />

      {/* Header — paddingTop dynamic from insets so content clears the status bar / notch */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={openDrawer} style={styles.hamburger}>
          <Text style={styles.hamburgerIcon}>☰</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{getPageTitle(pathname)}</Text>
        <View style={styles.headerRight} />
      </View>

      {/* Page Content — bottom safe-area inset is applied per-screen via useSafeAreaInsets,
          so each screen owns its own paddingBottom and can mix it with internal spacing. */}
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
                { backgroundColor: colors.black, opacity: overlayAnim },
              ]}
            />
          </TouchableOpacity>

          <Animated.View
            style={[
              styles.drawer,
              { transform: [{ translateX: slideAnim }] },
            ]}
          >
            {/* Drawer Header — top inset so logo doesn't sit under the status bar */}
            <View style={[styles.drawerHeader, { paddingTop: insets.top + 16 }]}>
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

            {/* Drawer Footer — bottom inset so footer text clears the nav bar */}
            <View style={[styles.drawerFooter, { paddingBottom: insets.bottom + 20 }]}>
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
    backgroundColor: colors.darkBg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.darkSurface,
    // paddingTop is applied inline from insets.top so the header clears the status bar / notch.
    paddingBottom: 12,
    paddingHorizontal: 16,
    elevation: 4,
    shadowColor: colors.black,
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
    color: colors.white,
  },
  headerTitle: {
    flex: 1,
    color: colors.white,
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
    backgroundColor: colors.darkSurface,
    elevation: 10,
    shadowColor: colors.black,
    shadowOffset: { width: 2, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    zIndex: 100,
  },
  drawerHeader: {
    // paddingTop applied inline from insets.top so the drawer logo clears the status bar / notch.
    paddingBottom: 24,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.drawerBorder,
    alignItems: 'center',
  },
  drawerLogo: {
    fontSize: 40,
    marginBottom: 8,
  },
  drawerTitle: {
    color: colors.white,
    fontFamily: fontFamilies.display,
    fontSize: typography.size.h1,
    fontWeight: typography.weight.extrabold,
    letterSpacing: typography.tracking.widest,
  },
  drawerSubtitle: {
    color: colors.textSecondary,
    fontFamily: fontFamilies.display,
    fontSize: typography.size.sm,
    letterSpacing: typography.tracking.wide,
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
    backgroundColor: colors.brandPrimaryAlpha15,
  },
  menuLabel: {
    color: colors.textMuted,
    fontSize: 16,
    fontWeight: '600',
  },
  menuLabelActive: {
    color: colors.brandPrimary,
  },
  drawerFooter: {
    // paddingBottom applied inline from insets.bottom so footer clears the nav bar / home indicator.
    paddingTop: 20,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: colors.drawerBorder,
    alignItems: 'center',
  },
  footerText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
});
