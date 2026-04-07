import React, { useState, useEffect } from 'react';
import {
  Text,
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  TextInput,
  Platform,
  Modal,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerMobilePushDevice, unregisterMobilePushDevice } from '../lib/mobileNotifications';
import { getBackendBaseUrl } from '../lib/backendUrl';

const EXPO_PUBLIC_BACKEND_URL = getBackendBaseUrl();
const BARBER_AUTH_KEY = '@barber_authed';
const BARBER_PUSH_KEY = '@barber_push_enabled';
const BARBER_PUSH_TOKEN_KEY = '@barber_push_token';

interface ServingEntry {
  id: string;
  tokenNumber: number;
  name: string;
  chairNumber: number | null;
  createdAt: string;
  serviceStartedAt?: string | null;
  expiresAt?: string | null;
  barberId?: string | null;
  barberName?: string | null;
}

interface WaitingEntry {
  id: string;
  tokenNumber: number;
  name: string;
  createdAt: string;
  barberId?: string | null;
  barberName?: string | null;
}

interface BarberInfo {
  id: string;
  name: string;
  chairNumber: number;
  isActive: boolean;
}

interface DashboardData {
  activeBarbers: number;
  servingCount: number;
  waitingCount: number;
  completedCount: number;
  servingList: ServingEntry[];
  waitingList: WaitingEntry[];
  completedList: any[];
  barbers: BarberInfo[];
}

export default function Dashboard() {
  const [isAuth, setIsAuth] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loginError, setLoginError] = useState('');
  const [data, setData] = useState<DashboardData | null>(null);
  const [toast, setToast] = useState('');
  const [sessionExpired, setSessionExpired] = useState(false);
  const [addName, setAddName] = useState('');
  const [barberPushEnabled, setBarberPushEnabled] = useState(false);
  const [barberPushLoading, setBarberPushLoading] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  
  // Login state (Username + Password only)
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  
  // Shop state
  const [shopId, setShopId] = useState<string | null>(null);
  const [shopName, setShopName] = useState<string>('');
  
  // Confirmation modal state
  const [confirmModal, setConfirmModal] = useState<{
    visible: boolean;
    type: 'done' | 'skip' | 'start';
    entry?: ServingEntry;
  }>({ visible: false, type: 'done' });
  
  // Barber filter state
  const [barberFilter, setBarberFilter] = useState<string | null>(null);
  const [showBarberPicker, setShowBarberPicker] = useState(false);
  
  // Add customer with barber selection
  const [addBarberSelection, setAddBarberSelection] = useState<string | null>(null);
  const [showAddBarberPicker, setShowAddBarberPicker] = useState(false);

  const getPushFailureMessage = (reason?: string) => {
    switch (reason) {
      case 'firebase-messaging-unavailable':
        return 'Firebase messaging not available. Rebuild the app.';
      case 'permission-denied':
      case 'permission-failed':
        return 'Notification permission denied. Enable in device settings.';
      case 'token-fetch-failed':
        return 'Failed to get FCM token.';
      case 'token-missing':
        return 'FCM token is empty.';
      case 'backend-register-failed':
        return 'Token created but backend registration failed.';
      default:
        return 'Failed to enable notifications.';
    }
  };

  const registerBarberPushForShop = async (
    currentShopId: string
  ): Promise<{ success: boolean; reason?: string; token?: string }> => {
    if (Platform.OS === 'web') {
      console.log('[FCM] Web platform - push not supported');
      return { success: false, reason: 'web-platform' };
    }

    // Guard: never register with empty/default shopId
    if (!currentShopId || currentShopId === 'default') {
      console.warn(`[FCM] Skipping barber push registration for invalid shopId: "${currentShopId}"`);
      return { success: false, reason: 'invalid-shop-id' };
    }

    console.log(`[FCM] Registering barber push for shop: ${currentShopId}`);
    const result = await registerMobilePushDevice({
      userType: 'barber',
      shopId: currentShopId,
      barberId: null,
      backendUrl: EXPO_PUBLIC_BACKEND_URL,
    });

    if (result.success && result.token) {
      await AsyncStorage.setItem(BARBER_PUSH_TOKEN_KEY, result.token);
      console.log('[FCM] Barber push token saved to storage');
    } else {
      console.warn(`[FCM] Barber push registration failed: ${result.reason}`);
    }

    return result;
  };

  useEffect(() => { checkAuth(); checkBarberPush(); }, []);

  useEffect(() => {
    if (isAuth && shopId) {
      fetchDashboard();
      const interval = setInterval(fetchDashboard, 15000); // Performance: 15s polling

      // Always re-register FCM token on dashboard load (token changes on app rebuild)
      console.log(`[FCM] Dashboard loaded for shop=${shopId}, re-registering barber push token...`);
      registerBarberPushForShop(shopId).then((result) => {
        if (result.success) {
          setBarberPushEnabled(true);
          AsyncStorage.setItem(BARBER_PUSH_KEY, 'true');
          console.log('[FCM] Barber push token re-registered on dashboard load');
        } else {
          console.warn(`[FCM] Barber push re-registration failed: ${result.reason}`);
        }
      }).catch((e) => {
        console.error('[FCM] Barber push re-registration error:', e);
      });

      return () => clearInterval(interval);
    }
  }, [isAuth, shopId, barberFilter]);

  const checkAuth = async () => {
    try {
      const authed = await AsyncStorage.getItem(BARBER_AUTH_KEY);
      const storedShopId = await AsyncStorage.getItem('@shop_id');
      const storedShopName = await AsyncStorage.getItem('@shop_name');
      console.log(`[AUTH] checkAuth: authed=${authed}, shopId=${storedShopId}, shopName=${storedShopName}`);
      if (authed === 'true' && storedShopId) {
        setIsAuth(true);
        setShopId(storedShopId);
        if (storedShopName) setShopName(storedShopName);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const checkBarberPush = async () => {
    try {
      const stored = await AsyncStorage.getItem(BARBER_PUSH_KEY);
      const token = await AsyncStorage.getItem(BARBER_PUSH_TOKEN_KEY);
      if (stored === 'true' || !!token) setBarberPushEnabled(true);
    } catch (e) { /* ignore */ }
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  // Login with Username + Password
  const handleLogin = async () => {
    setLoginError('');
    if (!username.trim() || !password.trim()) {
      setLoginError('Enter username and password');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${EXPO_PUBLIC_BACKEND_URL}/api/shop/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const d = await res.json();
      if (d.success) {
        await AsyncStorage.setItem(BARBER_AUTH_KEY, 'true');
        await AsyncStorage.setItem('@barber_login_time', new Date().toISOString());
        await AsyncStorage.setItem('@shop_id', d.shopId);
        await AsyncStorage.setItem('@shop_name', d.shopName || d.shopId);

        const pushRegistered = await registerBarberPushForShop(d.shopId);
        if (pushRegistered.success) {
          await AsyncStorage.setItem(BARBER_PUSH_KEY, 'true');
          setBarberPushEnabled(true);
        }

        setShopId(d.shopId);
        setShopName(d.shopName || d.shopId);
        setIsAuth(true);
      } else {
        setLoginError(d.message || 'Invalid credentials');
      }
    } catch (e) {
      setLoginError('Network error');
    } finally {
      setLoading(false);
    }
  };

  // Logout
  const handleLogout = async () => {
    const savedToken = await AsyncStorage.getItem(BARBER_PUSH_TOKEN_KEY);
    if (savedToken) {
      await unregisterMobilePushDevice(savedToken, EXPO_PUBLIC_BACKEND_URL);
    }

    await AsyncStorage.removeItem(BARBER_AUTH_KEY);
    await AsyncStorage.removeItem('@barber_login_time');
    await AsyncStorage.removeItem('@shop_id');
    await AsyncStorage.removeItem('@shop_name');
    await AsyncStorage.removeItem(BARBER_PUSH_KEY);
    await AsyncStorage.removeItem(BARBER_PUSH_TOKEN_KEY);

    setBarberPushEnabled(false);
    setIsAuth(false);
    setShopId(null);
    setShopName('');
    setData(null);
  };

  const handleEnableBarberPush = async () => {
    setBarberPushLoading(true);
    try {
      if (!shopId) {
        showToast('⚠ Shop not selected');
        setBarberPushLoading(false);
        return;
      }

      if (Platform.OS === 'web') {
        showToast('⚠ Push not supported on web');
        setBarberPushLoading(false);
        return;
      }

      console.log('[FCM] handleEnableBarberPush: starting...');
      const result = await registerBarberPushForShop(shopId);
      if (result.success) {
        setBarberPushEnabled(true);
        await AsyncStorage.setItem(BARBER_PUSH_KEY, 'true');
        showToast('🔔 Notifications enabled!');
        console.log('[FCM] Barber push enabled successfully');
      } else {
        showToast(`⚠ ${getPushFailureMessage(result.reason)}`);
        console.warn(`[FCM] Barber push failed: ${result.reason}`);
      }
    } catch (e) {
      showToast('⚠ Failed to enable notifications');
      console.error('[FCM] handleEnableBarberPush error:', e);
    } finally {
      setBarberPushLoading(false);
    }
  };

  const fetchDashboard = async () => {
    if (!shopId) return;
    try {
      // Check for session reset
      const sRes = await fetch(`${EXPO_PUBLIC_BACKEND_URL}/api/shop/${shopId}/session-status`);
      if (sRes.ok) {
        const sData = await sRes.json();
        if (sData.sessionReset) {
          const loginTime = await AsyncStorage.getItem('@barber_login_time');
          const resetAt = sData.sessionResetAt;
          if (resetAt && loginTime) {
            const resetDate = new Date(resetAt);
            const loginDate = new Date(loginTime);
            if (resetDate > loginDate) {
              await handleLogout();
              setSessionExpired(true);
              return;
            }
          }
        }
      }
      
      // Fetch shop-specific dashboard with optional barber filter
      let dashboardUrl = `${EXPO_PUBLIC_BACKEND_URL}/api/queue/${shopId}/dashboard`;
      if (barberFilter) {
        dashboardUrl += `?barber_id=${barberFilter}`;
      }
      const res = await fetch(dashboardUrl);
      if (res.ok) setData(await res.json());
    } catch (e) { console.error(e); }
  };

  // DONE with auto-next
  const handleDone = async (entryId: string, tokenNum: number) => {
    if (!shopId) return;
    try {
      const res = await fetch(`${EXPO_PUBLIC_BACKEND_URL}/api/queue/${shopId}/done/${entryId}`, { method: 'POST' });
      if (res.ok) {
        const r = await res.json();
        let msg = `✅ #${tokenNum} done.`;
        if (r.autoStarted) msg += ` Now serving #${r.autoStarted.tokenNumber}`;
        showToast(msg);
        fetchDashboard();
      }
    } catch (e) { console.error(e); }
    setConfirmModal({ visible: false, type: 'done' });
  };

  // START - mark service started (clears timer)
  const handleStart = async (entryId: string, tokenNum: number) => {
    if (!shopId) return;
    try {
      const res = await fetch(`${EXPO_PUBLIC_BACKEND_URL}/api/queue/${shopId}/start/${entryId}`, { method: 'POST' });
      if (res.ok) {
        showToast(`▶ Service started for #${tokenNum}`);
        fetchDashboard();
      }
    } catch (e) { console.error(e); }
    setConfirmModal({ visible: false, type: 'start' });
  };

  // SKIP - skip customer
  const handleSkip = async (entryId: string, tokenNum: number) => {
    if (!shopId) return;
    try {
      const res = await fetch(`${EXPO_PUBLIC_BACKEND_URL}/api/queue/${shopId}/skip/${entryId}`, { method: 'POST' });
      if (res.ok) {
        const r = await res.json();
        let msg = `⏭ #${tokenNum} skipped.`;
        if (r.autoStarted) msg += ` Now serving #${r.autoStarted.tokenNumber}`;
        showToast(msg);
        fetchDashboard();
      }
    } catch (e) { console.error(e); }
    setConfirmModal({ visible: false, type: 'skip' });
  };

  const handleStartNext = async () => {
    if (!shopId) return;
    try {
      let url = `${EXPO_PUBLIC_BACKEND_URL}/api/queue/${shopId}/start-next`;
      if (barberFilter) {
        url += `?barber_id=${barberFilter}`;
      }
      const res = await fetch(url, { method: 'POST' });
      if (res.ok) {
        const r = await res.json();
        showToast(`▶ Serving #${r.tokenNumber} (${r.name})`);
        fetchDashboard();
      } else {
        const err = await res.json();
        showToast(`⚠ ${err.detail}`);
      }
    } catch (e) { console.error(e); }
  };

  const handleAddCustomer = async () => {
    if (!addName.trim() || !shopId) { showToast('⚠ Enter customer name'); return; }
    try {
      const res = await fetch(`${EXPO_PUBLIC_BACKEND_URL}/api/queue/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name: addName.trim(), 
          addedBy: 'barber', 
          shopId,
          barberId: addBarberSelection || null
        }),
      });
      if (res.ok) {
        const r = await res.json();
        const barberName = addBarberSelection 
          ? data?.barbers?.find(b => b.id === addBarberSelection)?.name 
          : null;
        const msg = barberName 
          ? `✅ ${r.name} added — Token #${r.tokenNumber} → ${barberName}`
          : `✅ ${r.name} added — Token #${r.tokenNumber}`;
        showToast(msg);
        setAddName('');
        setAddBarberSelection(null);
        fetchDashboard();
      } else {
        const err = await res.json();
        showToast(`⚠ ${err.detail || 'Failed to add'}`);
      }
    } catch (e) { showToast('⚠ Network error'); }
  };

  // Loading state
  if (loading) {
    return <View style={s.center}><ActivityIndicator size="large" color="#007BFF" /></View>;
  }

  // Login screen (Username + Password only)
  if (!isAuth) {
    return (
      <ScrollView style={s.container} contentContainerStyle={s.scrollPad}>
        <View style={s.headerSection}>
          <Text style={s.brand}>Quevix</Text>
          <Text style={s.brandSub}>Smart Queue Platform</Text>
          <Text style={s.subtitle}>Barber Dashboard</Text>
        </View>
        {sessionExpired && (
          <View style={s.expiredBox}>
            <Text style={s.expiredTitle}>Session Expired</Text>
            <Text style={s.expiredMsg}>Admin reset your session. Please login again.</Text>
          </View>
        )}
        <View style={s.card}>
          <Text style={s.label}>Username</Text>
          <TextInput
            style={s.input}
            value={username}
            onChangeText={(t) => { setUsername(t); setLoginError(''); }}
            placeholder="Enter username"
            placeholderTextColor="#999"
            autoCapitalize="none"
          />
          <Text style={s.label}>Password</Text>
          <TextInput
            style={s.input}
            value={password}
            onChangeText={(t) => { setPassword(t); setLoginError(''); }}
            placeholder="Enter password"
            placeholderTextColor="#999"
            secureTextEntry
          />
          {loginError ? <Text style={s.error}>{loginError}</Text> : null}
          <TouchableOpacity style={s.btnPrimary} onPress={handleLogin}>
            <Text style={s.btnPrimaryText}>LOGIN</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  // Dashboard
  return (
    <ScrollView style={s.container}>
      {/* Header with Shop Name and Logout */}
      <View style={s.headerBar}>
        <View>
          <Text style={s.shopTitle}>{shopName || 'Dashboard'}</Text>
          <Text style={s.shopIdText}>ID: {shopId}</Text>
        </View>
        <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}>
          <Text style={s.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      {toast ? <View style={s.toast}><Text style={s.toastText}>{toast}</Text></View> : null}

      {/* Barber Filter Section (only show if barbers exist) */}
      {data?.barbers && data.barbers.length > 0 && (
        <View style={s.filterSection}>
          <Text style={s.filterLabel}>Filter by Barber:</Text>
          <TouchableOpacity 
            style={s.filterDropdown}
            onPress={() => setShowBarberPicker(true)}
          >
            <Text style={s.filterDropdownText}>
              {barberFilter 
                ? (data.barbers.find(b => b.id === barberFilter)?.name || 'Select Barber')
                : 'All Barbers'}
            </Text>
            <Text style={s.filterDropdownArrow}>▼</Text>
          </TouchableOpacity>
          {barberFilter && (
            <TouchableOpacity style={s.clearFilterBtn} onPress={() => setBarberFilter(null)}>
              <Text style={s.clearFilterText}>✕ Clear</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Push Notifications */}
      {!barberPushEnabled ? (
        <View style={s.pushSection}>
          <TouchableOpacity style={s.btnNotify} onPress={handleEnableBarberPush} disabled={barberPushLoading}>
            <Text style={s.btnNotifyText}>
              {barberPushLoading
                ? 'Enabling...'
                : Platform.OS === 'web'
                  ? '🔔 Enable Browser Notifications'
                  : '🔔 Enable Mobile Notifications'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={s.pushEnabled}>
          <Text style={s.pushEnabledText}>🔔 Notifications enabled</Text>
        </View>
      )}

      {/* Notification logs now appear in console (adb logcat or Metro bundler output) */}

      {/* Stats */}
      <View style={s.statsRow}>
        <View style={s.statBox}>
          <Text style={s.statNum}>{data?.activeBarbers || 0}</Text>
          <Text style={s.statLabel}>Chairs</Text>
        </View>
        <View style={s.statBox}>
          <Text style={s.statNum}>{data?.servingCount || 0}</Text>
          <Text style={s.statLabel}>Serving</Text>
        </View>
        <View style={s.statBox}>
          <Text style={s.statNum}>{data?.waitingCount || 0}</Text>
          <Text style={s.statLabel}>Waiting</Text>
        </View>
        <View style={s.statBox}>
          <Text style={s.statNum}>{data?.completedCount || 0}</Text>
          <Text style={s.statLabel}>Done</Text>
        </View>
      </View>

      {/* Chairs Section */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>
          {barberFilter 
            ? `Chair (${data?.barbers?.find(b => b.id === barberFilter)?.name || 'Filtered'})`
            : `Chairs`}
        </Text>
        {(() => {
          // When barber filter is ON, show only 1 chair for that barber
          // When barber filter is OFF, show all chairs
          const chairsToShow = barberFilter 
            ? 1 
            : (data?.activeBarbers || 1);
          
          // Get the chair number for filtered barber
          const filteredBarberChair = barberFilter 
            ? data?.barbers?.find(b => b.id === barberFilter)?.chairNumber || 1
            : null;
          
          return Array.from({ length: chairsToShow }, (_, i) => {
            // If barber filter is on, use that barber's chair number
            // Otherwise, use sequential chair numbers
            const chairNum = barberFilter ? filteredBarberChair : (i + 1);
            
            // Find serving entry for this chair
            let serving = null;
            if (barberFilter) {
              // When filtered, show the serving entry for this specific barber
              serving = data?.servingList?.find(e => e.barberId === barberFilter) || null;
            } else {
              serving = data?.servingList?.find(e => e.chairNumber === chairNum) || null;
            }
            
            // Calculate remaining time (expiresAt is in UTC)
            let timerDisplay = null;
            let timerMins = 0;
            if (serving?.expiresAt && !serving?.serviceStartedAt) {
              // Add 'Z' to make it parse as UTC
              const expiresAtStr = serving.expiresAt.endsWith('Z') ? serving.expiresAt : serving.expiresAt + 'Z';
              const expiresAt = new Date(expiresAtStr);
              const now = new Date();
              const diffMs = expiresAt.getTime() - now.getTime();
              timerMins = Math.max(0, Math.ceil(diffMs / 60000));
              timerDisplay = timerMins > 0 ? `⏱ ${timerMins} min left` : '⚠️ Timer expired!';
            }
            
            return (
              <View key={`chair-${chairNum}-${i}`} style={[s.chairCard, serving ? s.chairOccupied : s.chairEmpty]}>
                <View style={s.chairHeader}>
                  <Text style={s.chairLabel}>Chair {chairNum}</Text>
                  {serving?.barberName && <Text style={s.chairBarberName}>({serving.barberName})</Text>}
                </View>
                {serving ? (
                  <View style={s.chairBody}>
                    <View style={s.chairCustomer}>
                      <Text style={s.chairToken}>#{serving.tokenNumber}</Text>
                      <Text style={s.chairName}>{serving.name}</Text>
                      {timerDisplay && (
                        <Text style={[s.timerText, timerMins === 0 && s.timerExpired]}>
                          {timerDisplay}
                        </Text>
                      )}
                      {serving.serviceStartedAt && (
                        <Text style={s.serviceStarted}>✓ Service in progress</Text>
                      )}
                    </View>
                    <View style={s.chairActions}>
                      <TouchableOpacity 
                        style={s.btnSkip} 
                        onPress={() => setConfirmModal({ visible: true, type: 'skip', entry: serving })}
                      >
                        <Text style={s.btnActionText}>SKIP</Text>
                      </TouchableOpacity>
                      <TouchableOpacity 
                        style={s.btnDone} 
                        onPress={() => setConfirmModal({ visible: true, type: 'done', entry: serving })}
                      >
                        <Text style={s.btnActionText}>DONE</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <View style={s.chairBody}>
                    <Text style={s.chairEmptyText}>Empty</Text>
                    {data && data.waitingCount > 0 && (
                      <TouchableOpacity style={s.btnCallNext} onPress={handleStartNext}>
                        <Text style={s.btnCallNextText}>CALL NEXT</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            );
          });
        })()}
      </View>

      {/* Waiting List */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Waiting ({data?.waitingCount || 0})</Text>
        {data?.waitingList?.length ? (
          data.waitingList.map((e) => (
            <View key={e.id} style={s.waitingItem}>
              <Text style={s.waitingToken}>#{e.tokenNumber}</Text>
              <View style={s.waitingInfo}>
                <Text style={s.waitingName}>{e.name}</Text>
                {e.barberName && <Text style={s.waitingBarber}>→ {e.barberName}</Text>}
              </View>
            </View>
          ))
        ) : (
          <Text style={s.emptyText}>No one waiting</Text>
        )}
      </View>

      {/* Add Customer */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Add Customer</Text>
        <View style={s.addRow}>
          <TextInput
            style={[s.input, { flex: 1 }]}
            value={addName}
            onChangeText={setAddName}
            placeholder="Customer name"
            placeholderTextColor="#999"
          />
          <TouchableOpacity style={s.btnAdd} onPress={handleAddCustomer}>
            <Text style={s.btnAddText}>ADD</Text>
          </TouchableOpacity>
        </View>
        {/* Barber Selection for Add Customer */}
        {data?.barbers && data.barbers.length > 0 && (
          <View style={s.addBarberRow}>
            <Text style={s.addBarberLabel}>Assign to barber:</Text>
            <TouchableOpacity 
              style={s.addBarberDropdown}
              onPress={() => setShowAddBarberPicker(true)}
            >
              <Text style={s.addBarberDropdownText}>
                {addBarberSelection 
                  ? data.barbers.find(b => b.id === addBarberSelection)?.name || 'Select'
                  : 'Any Barber'}
              </Text>
              <Text style={s.filterDropdownArrow}>▼</Text>
            </TouchableOpacity>
            {addBarberSelection && (
              <TouchableOpacity style={s.clearFilterBtn} onPress={() => setAddBarberSelection(null)}>
                <Text style={s.clearFilterText}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      <View style={{ height: 40 }} />

      {/* Barber Picker Modal (for filter) */}
      <Modal visible={showBarberPicker} transparent animationType="fade">
        <View style={s.overlay}>
          <View style={s.pickerBox}>
            <Text style={s.pickerTitle}>Select Barber</Text>
            <ScrollView style={s.pickerList}>
              <TouchableOpacity 
                style={[s.pickerItem, !barberFilter && s.pickerItemSelected]}
                onPress={() => { setBarberFilter(null); setShowBarberPicker(false); }}
              >
                <Text style={[s.pickerItemText, !barberFilter && s.pickerItemTextSelected]}>
                  All Barbers
                </Text>
              </TouchableOpacity>
              {data?.barbers?.map((b) => (
                <TouchableOpacity 
                  key={b.id}
                  style={[s.pickerItem, barberFilter === b.id && s.pickerItemSelected]}
                  onPress={() => { setBarberFilter(b.id); setShowBarberPicker(false); }}
                >
                  <Text style={[s.pickerItemText, barberFilter === b.id && s.pickerItemTextSelected]}>
                    {b.name} (Chair {b.chairNumber})
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={s.pickerCancel} onPress={() => setShowBarberPicker(false)}>
              <Text style={s.pickerCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Barber Picker Modal (for adding customer) */}
      <Modal visible={showAddBarberPicker} transparent animationType="fade">
        <View style={s.overlay}>
          <View style={s.pickerBox}>
            <Text style={s.pickerTitle}>Assign to Barber</Text>
            <ScrollView style={s.pickerList}>
              <TouchableOpacity 
                style={[s.pickerItem, !addBarberSelection && s.pickerItemSelected]}
                onPress={() => { setAddBarberSelection(null); setShowAddBarberPicker(false); }}
              >
                <Text style={[s.pickerItemText, !addBarberSelection && s.pickerItemTextSelected]}>
                  Any Available Barber
                </Text>
              </TouchableOpacity>
              {data?.barbers?.filter(b => b.isActive).map((b) => (
                <TouchableOpacity 
                  key={b.id}
                  style={[s.pickerItem, addBarberSelection === b.id && s.pickerItemSelected]}
                  onPress={() => { setAddBarberSelection(b.id); setShowAddBarberPicker(false); }}
                >
                  <Text style={[s.pickerItemText, addBarberSelection === b.id && s.pickerItemTextSelected]}>
                    {b.name} (Chair {b.chairNumber})
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={s.pickerCancel} onPress={() => setShowAddBarberPicker(false)}>
              <Text style={s.pickerCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Confirmation Modal */}
      <Modal visible={confirmModal.visible} transparent animationType="fade">
        <View style={s.overlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>
              {confirmModal.type === 'done' && 'Mark as Done?'}
              {confirmModal.type === 'start' && 'Start Service?'}
              {confirmModal.type === 'skip' && 'Skip Customer?'}
            </Text>
            <Text style={s.modalMsg}>
              {confirmModal.type === 'done' && `Complete service for #${confirmModal.entry?.tokenNumber} (${confirmModal.entry?.name})?`}
              {confirmModal.type === 'start' && `Start service for #${confirmModal.entry?.tokenNumber}? This clears the waiting timer.`}
              {confirmModal.type === 'skip' && `Skip #${confirmModal.entry?.tokenNumber} (${confirmModal.entry?.name})? They must take a new token.`}
            </Text>
            <View style={s.modalBtns}>
              <TouchableOpacity style={s.mCancel} onPress={() => setConfirmModal({ visible: false, type: 'done' })}>
                <Text style={s.mCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[s.mConfirm, confirmModal.type === 'skip' && s.mConfirmDanger]} 
                onPress={() => {
                  const entry = confirmModal.entry;
                  if (entry) {
                    if (confirmModal.type === 'done') handleDone(entry.id, entry.tokenNumber);
                    if (confirmModal.type === 'start') handleStart(entry.id, entry.tokenNumber);
                    if (confirmModal.type === 'skip') handleSkip(entry.id, entry.tokenNumber);
                  }
                }}
              >
                <Text style={s.mConfirmText}>
                  {confirmModal.type === 'done' && 'Done'}
                  {confirmModal.type === 'start' && 'Start'}
                  {confirmModal.type === 'skip' && 'Skip'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F8F9FA' },
  scrollPad: { padding: 16, paddingTop: 56 },
  headerSection: { marginBottom: 24 },
  brand: { fontSize: 28, fontWeight: '800', color: '#1A1A2E' },
  brandSub: { fontSize: 14, color: '#6C757D', marginTop: 2 },
  subtitle: { fontSize: 16, color: '#495057', marginTop: 12 },

  headerBar: { padding: 16, paddingTop: 56, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E9ECEF', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  shopTitle: { fontSize: 20, fontWeight: '700', color: '#1A1A2E' },
  shopIdText: { fontSize: 12, color: '#6C757D', marginTop: 2 },
  logoutBtn: { backgroundColor: '#F8D7DA', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  logoutText: { fontSize: 14, color: '#DC3545', fontWeight: '600' },

  card: { backgroundColor: '#fff', borderRadius: 12, padding: 20, borderWidth: 1, borderColor: '#E9ECEF' },
  label: { fontSize: 15, fontWeight: '600', color: '#495057', marginBottom: 8, marginTop: 12 },
  input: { borderWidth: 1, borderColor: '#CED4DA', borderRadius: 8, padding: 14, fontSize: 16, marginBottom: 8, backgroundColor: '#fff' },
  error: { color: '#DC3545', fontSize: 13, marginBottom: 8 },
  btnPrimary: { backgroundColor: '#007BFF', padding: 16, borderRadius: 10, alignItems: 'center', marginTop: 12 },
  btnPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  expiredBox: { backgroundColor: '#FFF3CD', padding: 16, borderRadius: 10, marginBottom: 16, borderWidth: 1, borderColor: '#FFE69C' },
  expiredTitle: { fontSize: 16, fontWeight: '700', color: '#664D03' },
  expiredMsg: { fontSize: 14, color: '#664D03', marginTop: 4 },

  toast: { backgroundColor: '#28A745', padding: 14, margin: 16, borderRadius: 10, alignItems: 'center' },
  toastText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  pushSection: { padding: 16 },
  btnNotify: { backgroundColor: '#6F42C1', padding: 14, borderRadius: 10, alignItems: 'center' },
  btnNotifyText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  pushEnabled: { margin: 16, backgroundColor: '#D4EDDA', padding: 12, borderRadius: 10, alignItems: 'center' },
  pushEnabledText: { color: '#155724', fontSize: 13, fontWeight: '500' },

  logSection: { marginHorizontal: 16, marginTop: 4, marginBottom: 8, backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#E9ECEF', padding: 12 },
  logHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logTitle: { fontSize: 14, fontWeight: '700', color: '#1A1A2E' },
  logActionRow: { flexDirection: 'row', gap: 8 },
  logActionBtn: { backgroundColor: '#E7F3FF', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  logActionBtnText: { color: '#007BFF', fontSize: 12, fontWeight: '700' },
  logClearBtn: { backgroundColor: '#F8D7DA', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  logClearBtnText: { color: '#B4232A', fontSize: 12, fontWeight: '700' },
  logHint: { marginTop: 8, marginBottom: 10, color: '#6C757D', fontSize: 12 },
  logEmpty: { color: '#6C757D', fontSize: 12 },
  logItem: { backgroundColor: '#F8F9FA', borderRadius: 8, padding: 8, marginBottom: 8 },
  logMeta: { fontSize: 11, color: '#6C757D', fontWeight: '600' },
  logMessage: { fontSize: 13, color: '#1A1A2E', marginTop: 2 },
  logDetails: { fontSize: 11, color: '#495057', marginTop: 4 },

  statsRow: { flexDirection: 'row', margin: 16, gap: 10 },
  statBox: { flex: 1, backgroundColor: '#fff', padding: 16, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: '#E9ECEF' },
  statNum: { fontSize: 24, fontWeight: '800', color: '#1A1A2E' },
  statLabel: { fontSize: 12, color: '#6C757D', marginTop: 4 },

  section: { marginHorizontal: 16, marginTop: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#1A1A2E', marginBottom: 12 },

  chairCard: { borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1 },
  chairOccupied: { backgroundColor: '#E7F3FF', borderColor: '#B6D4FE' },
  chairEmpty: { backgroundColor: '#fff', borderColor: '#E9ECEF' },
  chairHeader: { marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chairLabel: { fontSize: 15, fontWeight: '700', color: '#495057' },
  chairBarberName: { fontSize: 13, color: '#6C757D', fontStyle: 'italic' },
  chairBody: {},
  chairCustomer: { marginBottom: 12 },
  chairToken: { fontSize: 28, fontWeight: '800', color: '#007BFF' },
  chairName: { fontSize: 16, color: '#1A1A2E', marginTop: 4 },
  chairEmptyText: { fontSize: 15, color: '#ADB5BD' },
  chairActions: { flexDirection: 'row', gap: 8 },
  btnStart: { backgroundColor: '#17A2B8', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  btnSkip: { backgroundColor: '#FD7E14', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  btnDone: { backgroundColor: '#28A745', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  btnActionText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  btnCallNext: { backgroundColor: '#007BFF', padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 8 },
  btnCallNextText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  timerText: { fontSize: 12, color: '#17A2B8', fontWeight: '600', marginTop: 4 },
  timerExpired: { color: '#DC3545' },
  serviceStarted: { fontSize: 12, color: '#28A745', fontWeight: '600', marginTop: 4 },

  waitingItem: { flexDirection: 'row', backgroundColor: '#fff', padding: 14, borderRadius: 10, marginBottom: 8, alignItems: 'center', borderWidth: 1, borderColor: '#E9ECEF' },
  waitingToken: { fontSize: 18, fontWeight: '700', color: '#007BFF', width: 50 },
  waitingInfo: { flex: 1 },
  waitingName: { fontSize: 15, color: '#1A1A2E' },
  waitingBarber: { fontSize: 12, color: '#6C757D', marginTop: 2 },
  emptyText: { fontSize: 14, color: '#ADB5BD', fontStyle: 'italic' },

  // Barber filter styles
  filterSection: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E9ECEF' },
  filterLabel: { fontSize: 14, color: '#495057', marginRight: 8 },
  filterDropdown: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F0F0F0', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, flex: 1, justifyContent: 'space-between' },
  filterDropdownText: { fontSize: 14, color: '#1A1A2E' },
  filterDropdownArrow: { fontSize: 10, color: '#6C757D', marginLeft: 8 },
  clearFilterBtn: { marginLeft: 10, backgroundColor: '#F8D7DA', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  clearFilterText: { fontSize: 12, color: '#DC3545', fontWeight: '600' },

  // Barber picker modal styles
  pickerBox: { backgroundColor: '#fff', borderRadius: 16, padding: 20, width: '85%', maxWidth: 360, maxHeight: '70%' },
  pickerTitle: { fontSize: 18, fontWeight: '700', color: '#1A1A2E', marginBottom: 16, textAlign: 'center' },
  pickerList: { maxHeight: 300 },
  pickerItem: { padding: 14, borderRadius: 8, marginBottom: 8, backgroundColor: '#F8F9FA' },
  pickerItemSelected: { backgroundColor: '#007BFF' },
  pickerItemText: { fontSize: 15, color: '#1A1A2E' },
  pickerItemTextSelected: { color: '#fff', fontWeight: '600' },
  pickerCancel: { padding: 14, borderRadius: 10, alignItems: 'center', backgroundColor: '#F0F0F0', marginTop: 12 },
  pickerCancelText: { color: '#333', fontSize: 15, fontWeight: '600' },

  addRow: { flexDirection: 'row', gap: 10 },
  btnAdd: { backgroundColor: '#28A745', paddingHorizontal: 20, paddingVertical: 14, borderRadius: 8 },
  btnAddText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  // Add customer barber selection styles
  addBarberRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  addBarberLabel: { fontSize: 13, color: '#495057', marginRight: 8 },
  addBarberDropdown: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8F9FA', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#CED4DA', flex: 1, justifyContent: 'space-between' },
  addBarberDropdownText: { fontSize: 14, color: '#1A1A2E' },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalBox: { backgroundColor: '#fff', borderRadius: 16, padding: 24, width: '85%', maxWidth: 360 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#1A1A2E', marginBottom: 8, textAlign: 'center' },
  modalMsg: { fontSize: 15, color: '#6C757D', marginBottom: 20, textAlign: 'center' },
  modalBtns: { flexDirection: 'row', gap: 12 },
  mCancel: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center', backgroundColor: '#F0F0F0' },
  mConfirm: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center', backgroundColor: '#28A745' },
  mConfirmDanger: { backgroundColor: '#DC3545' },
  mCancelText: { color: '#333', fontSize: 15, fontWeight: '600' },
  mConfirmText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
