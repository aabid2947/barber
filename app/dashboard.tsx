import React, { useState, useEffect, useRef } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { registerMobilePushDevice, unregisterMobilePushDevice } from '../lib/mobileNotifications';
import { getBackendBaseUrl } from '../lib/backendUrl';
import { fetchWithRetry } from '../lib/fetchWithRetry';
import { colors, fontFamilies, typography } from '../lib/theme';

const EXPO_PUBLIC_BACKEND_URL = getBackendBaseUrl();
const BARBER_AUTH_KEY = '@barber_authed';
const BARBER_PUSH_KEY = '@barber_push_enabled';
const BARBER_PUSH_TOKEN_KEY = '@barber_push_token';
const DASHBOARD_CACHE_PREFIX = '@dashboard_cache_v1:';
const dashboardCacheKey = (shopId: string, barberFilter: string | null) =>
  `${DASHBOARD_CACHE_PREFIX}${shopId}:${barberFilter || 'all'}`;

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
  // Bottom safe-area inset so the bottom of every ScrollView clears the
  // Android 3-button nav / iOS home indicator.
  const insets = useSafeAreaInsets();
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

  // In-flight action tracker — keys are entry IDs or sentinel strings (e.g. "start-next:<barberId|all>")
  // Any key present means a barber-dashboard action is waiting on a backend response; used to
  // visually disable the triggering button so multi-taps don't fire the same mutation twice.
  const [pendingActions, setPendingActions] = useState<Set<string>>(new Set());
  const startNextKeyFor = (barberId: string | null) => `start-next:${barberId || 'all'}`;

  // Monotonic generation counter — bumped by every mutation start and every new fetchDashboard.
  // fetchDashboard captures the gen at request time and drops its response if the gen has moved
  // on, so in-flight polls can't overwrite a fresher optimistic update or a newer fetch result.
  // This kills the "skipped customer reappears for ~1s" flicker: a poll started just before SKIP
  // would otherwise resolve with pre-skip data after the optimistic update and clobber the chair.
  const fetchGenRef = useRef(0);

  const markPending = (key: string) => {
    fetchGenRef.current += 1;
    setPendingActions(prev => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  };
  const clearPending = (key: string) => setPendingActions(prev => {
    if (!prev.has(key)) return prev;
    const next = new Set(prev);
    next.delete(key);
    return next;
  });

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

    // Guard: never register with empty shopId
    if (!currentShopId) {
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
      // Hydrate from cache synchronously-first so all chair cards render immediately with the
      // correct activeBarbers count. Without this, data is null on first paint and the chair
      // loop renders a single placeholder until the network returns.
      (async () => {
        try {
          const cached = await AsyncStorage.getItem(dashboardCacheKey(shopId, barberFilter));
          if (cached) {
            const parsed: DashboardData = JSON.parse(cached);
            // Only hydrate if we don't already have fresher data from a previous in-flight fetch.
            setData(prev => prev ?? parsed);
          }
        } catch (e) {
          // Corrupt cache is non-fatal — the network fetch below will overwrite it.
        }
      })();

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
      const d = await res.json();      console.log(`[AUTH] Login API Response:`, JSON.stringify(d, null, 2));      if (d.success) {
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
    // Capture the current generation. If it advances before we resolve (because a mutation
    // started or a newer fetch was kicked off), we drop our response as stale.
    const gen = ++fetchGenRef.current;
    try {
      // Check for session reset — uses fetchWithRetry so a transient blip doesn't drop the poll.
      const sRes = await fetchWithRetry(`${EXPO_PUBLIC_BACKEND_URL}/api/shop/${shopId}/session-status`);
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

      // Fetch shop-specific dashboard with optional barber filter.
      let dashboardUrl = `${EXPO_PUBLIC_BACKEND_URL}/api/queue/${shopId}/dashboard`;
      if (barberFilter) {
        dashboardUrl += `?barber_id=${barberFilter}`;
      }
      const res = await fetchWithRetry(dashboardUrl);
      if (res.ok) {
        const fresh: DashboardData = await res.json();
        if (gen !== fetchGenRef.current) return; // superseded — drop to avoid clobbering newer state
        setData(fresh);
        // Persist so the next mount can render all chairs without waiting on the network.
        AsyncStorage.setItem(dashboardCacheKey(shopId, barberFilter), JSON.stringify(fresh)).catch(() => {});
      }
    } catch (e) { console.error(e); }
  };

  // Pick the waiting entry that the backend would promote next for a given barber scope.
  // Mirrors backend ordering in start_next_for_shop / done_serving_shop: this barber's queue first,
  // then the general (barberId == null) queue. Returns null if nothing eligible.
  const pickNextWaiting = (
    waitingList: WaitingEntry[] | undefined,
    barberId: string | null,
  ): { entry: WaitingEntry; index: number } | null => {
    if (!waitingList || waitingList.length === 0) return null;
    if (barberId) {
      const i = waitingList.findIndex(w => w.barberId === barberId);
      if (i !== -1) return { entry: waitingList[i], index: i };
    }
    const j = waitingList.findIndex(w => !w.barberId);
    if (j !== -1) return { entry: waitingList[j], index: j };
    return null;
  };

  const findOpenChair = (d: DashboardData, preferredChair: number | null): number | null => {
    const activeBarbers = d.activeBarbers || 1;
    const occupied = new Set((d.servingList || []).map(e => e.chairNumber).filter((c): c is number => !!c));
    if (preferredChair && !occupied.has(preferredChair)) return preferredChair;
    for (let c = 1; c <= activeBarbers; c++) {
      if (!occupied.has(c)) return c;
    }
    return null;
  };

  // Remove the serving entry and, if there's a next-in-line, promote it into the freed chair.
  // Keeps counts in sync so the chair card re-renders immediately with the new occupant.
  //
  // Important: we always perform the *removal* even if the entry can't be found in the current
  // servingList (e.g. polling raced and replaced the array). Bailing early on `!removed` was the
  // root cause of "I clicked Skip but the customer stayed in the chair" — if the lookup missed,
  // the optimistic remove was silently skipped and the chair waited on the post-action fetch.
  const applyOptimisticComplete = (entryId: string, completedStatus: 'completed' | 'skipped') => {
    setData(prev => {
      if (!prev) return prev;
      const removed = prev.servingList?.find(e => e.id === entryId);
      // Always strip the entry by id — idempotent if it's already gone.
      let newServing = (prev.servingList || []).filter(e => e.id !== entryId);
      let newWaiting = prev.waitingList || [];

      // Only attempt auto-promotion when we can reason about the freed chair / barber. If the
      // entry wasn't in the current list (likely a stale modal handle), we still removed it
      // above; the post-action fetchDashboard will reconcile the promoted next-in-line.
      if (removed) {
        const chair = removed.chairNumber ?? null;
        // Mirror backend: only this barber's queue or general queue, never another barber's.
        const scopeBarberId = removed.barberId ?? null;
        const pick = pickNextWaiting(newWaiting, scopeBarberId);
        if (pick && chair) {
          const promoted: ServingEntry = {
            id: pick.entry.id,
            tokenNumber: pick.entry.tokenNumber,
            name: pick.entry.name,
            createdAt: pick.entry.createdAt,
            chairNumber: chair,
            // Anonymous joiners stay anonymous on promotion — no chair-owner fallback.
            barberId: pick.entry.barberId ?? null,
            barberName: pick.entry.barberName ?? null,
            expiresAt: null,
            serviceStartedAt: null,
          };
          newServing = [...newServing, promoted];
          newWaiting = newWaiting.filter((_, i) => i !== pick.index);
        }
      }

      return {
        ...prev,
        servingList: newServing,
        waitingList: newWaiting,
        servingCount: newServing.length,
        waitingCount: newWaiting.length,
        completedCount: completedStatus === 'completed' ? (prev.completedCount || 0) + 1 : prev.completedCount,
      };
    });
  };

  // Promote the next waiting entry into the first open chair, respecting the target barber scope.
  // `targetBarberId` is the barber that owns the chair the button was tapped on (or the global
  // filter when set). `explicitChair` is the chair number the user tapped — it wins over the
  // barber's owned chair so users always land the customer in the chair they clicked, even when
  // that chair has no owning barber (activeBarbers > barbers.length).
  const applyOptimisticStartNext = (targetBarberId: string | null, explicitChair: number | null = null) => {
    setData(prev => {
      if (!prev) return prev;
      const pick = pickNextWaiting(prev.waitingList, targetBarberId);
      if (!pick) return prev;
      // Tapped chair wins; otherwise barber's assigned chair; otherwise first open.
      const preferredChair = explicitChair ?? (targetBarberId
        ? prev.barbers?.find(b => b.id === targetBarberId)?.chairNumber || null
        : null);
      const chair = findOpenChair(prev, preferredChair);
      if (!chair) return prev;
      const promoted: ServingEntry = {
        id: pick.entry.id,
        tokenNumber: pick.entry.tokenNumber,
        name: pick.entry.name,
        createdAt: pick.entry.createdAt,
        chairNumber: chair,
        // Anonymous joiners stay anonymous on promotion — chair owner is not assigned.
        barberId: pick.entry.barberId ?? null,
        barberName: pick.entry.barberName ?? null,
        expiresAt: null,
        serviceStartedAt: null,
      };
      const newServing = [...(prev.servingList || []), promoted];
      const newWaiting = (prev.waitingList || []).filter((_, i) => i !== pick.index);
      return {
        ...prev,
        servingList: newServing,
        waitingList: newWaiting,
        servingCount: newServing.length,
        waitingCount: newWaiting.length,
      };
    });
  };

  // DONE with auto-next — optimistic UI updates instantly, then a fetchDashboard reconciles
  // against backend truth. We always reconcile (not just on error) because the auto-promotion
  // path on the server has barber-assignment rules that the local guess can't always reproduce
  // (e.g. only waiting customer belongs to a different barber → backend skips promotion → our
  // optimistic state would otherwise drift and require a manual refresh).
  const handleDone = async (entryId: string, tokenNum: number) => {
    if (!shopId) return;
    if (pendingActions.has(entryId)) return;
    setConfirmModal({ visible: false, type: 'done' });
    markPending(entryId);
    applyOptimisticComplete(entryId, 'completed');
    showToast(`✅ #${tokenNum} done.`);
    try {
      const res = await fetchWithRetry(`${EXPO_PUBLIC_BACKEND_URL}/api/queue/${shopId}/done/${entryId}`, { method: 'POST' });
      if (res.ok) {
        const r = await res.json();
        if (r.autoStarted) showToast(`▶ Now serving #${r.autoStarted.tokenNumber}`);
      } else {
        showToast('⚠ Failed to complete — refreshing');
      }
    } catch (e) {
      console.error(e);
      showToast('⚠ Network error — refreshing');
    } finally {
      clearPending(entryId);
      fetchDashboard();
    }
  };

  // START - mark service started (clears timer). Optimistic flip is enough; no reload on success.
  const handleStart = async (entryId: string, tokenNum: number) => {
    if (!shopId) return;
    if (pendingActions.has(entryId)) return;
    setConfirmModal({ visible: false, type: 'start' });
    markPending(entryId);
    setData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        servingList: (prev.servingList || []).map(e =>
          e.id === entryId ? { ...e, serviceStartedAt: new Date().toISOString(), expiresAt: null } : e
        ),
      };
    });
    showToast(`▶ Service started for #${tokenNum}`);
    let ok = false;
    try {
      const res = await fetchWithRetry(`${EXPO_PUBLIC_BACKEND_URL}/api/queue/${shopId}/start/${entryId}`, { method: 'POST' });
      ok = res.ok;
    } catch (e) { console.error(e); }
    finally {
      clearPending(entryId);
      if (!ok) fetchDashboard();
    }
  };

  // SKIP - skip customer. Same reconcile-from-server pattern as DONE for the same reason.
  const handleSkip = async (entryId: string, tokenNum: number) => {
    if (!shopId) return;
    if (pendingActions.has(entryId)) return;
    setConfirmModal({ visible: false, type: 'skip' });
    markPending(entryId);
    applyOptimisticComplete(entryId, 'skipped');
    showToast(`⏭ #${tokenNum} skipped.`);
    try {
      const res = await fetchWithRetry(`${EXPO_PUBLIC_BACKEND_URL}/api/queue/${shopId}/skip/${entryId}`, { method: 'POST' });
      if (res.ok) {
        const r = await res.json();
        if (r.autoStarted) showToast(`▶ Now serving #${r.autoStarted.tokenNumber}`);
      }
    } catch (e) { console.error(e); }
    finally {
      clearPending(entryId);
      fetchDashboard();
    }
  };

  // CALL NEXT — optimistic promote + always reconcile from server so the chair shows the
  // exact entry the backend chose (chair number can differ from our local guess).
  // `chairBarberId` is the barber that owns the chair the user tapped (or null for ownerless
  // chairs). `chairNumber` is the chair the user tapped — passed to the backend so the customer
  // is placed in that specific chair rather than the lowest-empty fallback.
  const handleStartNext = async (chairBarberId: string | null = null, chairNumber: number | null = null) => {
    if (!shopId) return;
    const targetBarberId = chairBarberId ?? barberFilter;
    const key = startNextKeyFor(targetBarberId);
    if (pendingActions.has(key)) return;
    markPending(key);
    applyOptimisticStartNext(targetBarberId, chairNumber);
    try {
      let url = `${EXPO_PUBLIC_BACKEND_URL}/api/queue/${shopId}/start-next`;
      const params: string[] = [];
      if (targetBarberId) params.push(`barber_id=${targetBarberId}`);
      if (chairNumber) params.push(`chair_number=${chairNumber}`);
      if (params.length) url += `?${params.join('&')}`;
      const res = await fetchWithRetry(url, { method: 'POST' });
      if (res.ok) {
        const r = await res.json();
        showToast(`▶ Serving #${r.tokenNumber} (${r.name})`);
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(`⚠ ${err.detail || 'Failed to call next'}`);
      }
    } catch (e) { console.error(e); }
    finally {
      clearPending(key);
      fetchDashboard();
    }
  };

  const handleAddCustomer = async () => {
    if (!addName.trim() || !shopId) { showToast('⚠ Enter customer name'); return; }
    if (pendingActions.has('add-customer')) return;
    const selectedBarberId = addBarberSelection;
    markPending('add-customer');
    try {
      const res = await fetchWithRetry(`${EXPO_PUBLIC_BACKEND_URL}/api/queue/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: addName.trim(),
          addedBy: 'barber',
          shopId,
          barberId: selectedBarberId || null
        }),
      });
      if (res.ok) {
        const r = await res.json();
        const barberName = selectedBarberId
          ? data?.barbers?.find(b => b.id === selectedBarberId)?.name
          : null;
        const msg = barberName
          ? `✅ ${r.name} added — Token #${r.tokenNumber} → ${barberName}`
          : `✅ ${r.name} added — Token #${r.tokenNumber}`;
        showToast(msg);
        setAddName('');
        setAddBarberSelection(null);

        // Delta update: append the new entry to waitingList instead of reloading the whole dashboard.
        // The join response already contains everything we need to render the row.
        setData(prev => {
          if (!prev) return prev;
          const newWaiting: WaitingEntry = {
            id: r.id,
            tokenNumber: r.tokenNumber,
            name: r.name,
            createdAt: r.createdAt,
            barberId: selectedBarberId || null,
            barberName: barberName || null,
          };
          const newList = [...(prev.waitingList || []), newWaiting];
          return { ...prev, waitingList: newList, waitingCount: newList.length };
        });
      } else {
        const err = await res.json();
        showToast(`⚠ ${err.detail || 'Failed to add'}`);
        fetchDashboard();
      }
    } catch (e) {
      showToast('⚠ Network error');
      fetchDashboard();
    } finally {
      clearPending('add-customer');
    }
  };

  // Loading state
  if (loading) {
    return <View style={s.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View>;
  }

  // Login screen (Username + Password only)
  if (!isAuth) {
    return (
      <KeyboardAwareScrollView
        style={s.container}
        contentContainerStyle={[s.scrollPad, { paddingBottom: 16 + insets.bottom }]}
        bottomOffset={24}
      >
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
            placeholderTextColor={colors.textPlaceholder}
            autoCapitalize="none"
          />
          <Text style={s.label}>Password</Text>
          <TextInput
            style={s.input}
            value={password}
            onChangeText={(t) => { setPassword(t); setLoginError(''); }}
            placeholder="Enter password"
            placeholderTextColor={colors.textPlaceholder}
            secureTextEntry
          />
          {loginError ? <Text style={s.error}>{loginError}</Text> : null}
          <TouchableOpacity style={s.btnPrimary} onPress={handleLogin}>
            <Text style={s.btnPrimaryText}>LOGIN</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAwareScrollView>
    );
  }

  // Dashboard — KeyboardAwareScrollView so the Add-Customer input scrolls into view when focused.
  return (
    <KeyboardAwareScrollView
      style={s.container}
      contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
      bottomOffset={24}
    >
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
        {!data ? (
          // First-ever login, no cache yet — don't guess at a chair count.
          <View style={s.chairsLoader}>
            <ActivityIndicator size="small" color={colors.brandPrimary} />
            <Text style={s.chairsLoaderText}>Loading chairs...</Text>
          </View>
        ) : (() => {
          // When barber filter is ON, show only 1 chair for that barber
          // When barber filter is OFF, show all chairs
          const chairsToShow = barberFilter
            ? 1
            : (data.activeBarbers || 1);
          
          // Get the chair number for filtered barber
          const filteredBarberChair = barberFilter 
            ? data?.barbers?.find(b => b.id === barberFilter)?.chairNumber || 1
            : null;
          
          return Array.from({ length: chairsToShow }, (_, i) => {
            // If barber filter is on, use that barber's chair number
            // Otherwise, use sequential chair numbers
            const chairNum = barberFilter ? filteredBarberChair : (i + 1);

            // Resolve the barber that owns this chair. Without filter we look it up from
            // data.barbers by chairNumber so CALL NEXT can target this barber's queue.
            const chairBarberId = barberFilter
              ?? (data?.barbers?.find(b => b.chairNumber === chairNum)?.id ?? null);
            const chairStartNextKey = startNextKeyFor(chairBarberId);

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
                  {serving?.barberId && serving?.barberName ? <Text style={s.chairBarberName}>({serving.barberName})</Text> : null}
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
                        style={[s.btnSkip, pendingActions.has(serving.id) && s.btnDisabled]}
                        disabled={pendingActions.has(serving.id)}
                        onPress={() => setConfirmModal({ visible: true, type: 'skip', entry: serving })}
                      >
                        {pendingActions.has(serving.id)
                          ? <ActivityIndicator color="#fff" size="small" />
                          : <Text style={s.btnActionText}>SKIP</Text>}
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[s.btnDone, pendingActions.has(serving.id) && s.btnDisabled]}
                        disabled={pendingActions.has(serving.id)}
                        onPress={() => setConfirmModal({ visible: true, type: 'done', entry: serving })}
                      >
                        {pendingActions.has(serving.id)
                          ? <ActivityIndicator color="#fff" size="small" />
                          : <Text style={s.btnActionText}>DONE</Text>}
                      </TouchableOpacity>
                    </View>
                    {pendingActions.has(serving.id) && (
                      <View style={s.chairProcessing}>
                        <ActivityIndicator size="small" color="#007BFF" />
                        <Text style={s.chairProcessingText}>Processing…</Text>
                      </View>
                    )}
                  </View>
                ) : (
                  <View style={s.chairBody}>
                    <Text style={s.chairEmptyText}>Empty</Text>
                    {data && data.waitingCount > 0 && (
                      <TouchableOpacity
                        style={[s.btnCallNext, pendingActions.has(chairStartNextKey) && s.btnDisabled]}
                        disabled={pendingActions.has(chairStartNextKey)}
                        onPress={() => handleStartNext(chairBarberId, chairNum)}
                      >
                        {pendingActions.has(chairStartNextKey)
                          ? <ActivityIndicator color="#fff" size="small" />
                          : <Text style={s.btnCallNextText}>CALL NEXT</Text>}
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
                {e.barberId && e.barberName ? <Text style={s.waitingBarber}>→ {e.barberName}</Text> : null}
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
            placeholderTextColor={colors.textPlaceholder}
          />
          <TouchableOpacity
            style={[s.btnAdd, pendingActions.has('add-customer') && s.btnDisabled]}
            disabled={pendingActions.has('add-customer')}
            onPress={handleAddCustomer}
          >
            {pendingActions.has('add-customer')
              ? <ActivityIndicator color={colors.white} />
              : <Text style={s.btnAddText}>ADD</Text>}
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
                  ? data.barbers.find(b => b.id === addBarberSelection)?.name || 'Select Barber'
                  : 'Select Barber'}
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
                  Select Barber
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

      {/* Confirmation Modal — animationType="none" so the modal (with its customer-name text)
          disappears instantly when Done/Skip is tapped, instead of fading over the chair card. */}
      <Modal visible={confirmModal.visible} transparent animationType="none">
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
                style={[
                  s.mConfirm,
                  confirmModal.type === 'skip' && s.mConfirmDanger,
                  !!confirmModal.entry && pendingActions.has(confirmModal.entry.id) && s.btnDisabled,
                ]}
                disabled={!!confirmModal.entry && pendingActions.has(confirmModal.entry.id)}
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
    </KeyboardAwareScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  scrollPad: { padding: 16, paddingTop: 56 },
  headerSection: { marginBottom: 24 },
  brand: { fontFamily: fontFamilies.display, fontSize: typography.size.display, fontWeight: typography.weight.extrabold, color: colors.textPrimary, letterSpacing: typography.tracking.wider },
  brandSub: { fontFamily: fontFamilies.display, fontSize: typography.size.base, color: colors.textSecondary, marginTop: 2, letterSpacing: typography.tracking.wide },
  subtitle: { fontSize: 16, color: colors.textPrimary, marginTop: 12 },

  headerBar: { padding: 16, paddingTop: 56, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  shopTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  shopIdText: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  logoutBtn: { backgroundColor: colors.dangerBg, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  logoutText: { fontSize: 14, color: colors.danger, fontWeight: '600' },

  card: { backgroundColor: colors.white, borderRadius: 12, padding: 20, borderWidth: 1, borderColor: colors.border },
  label: { fontSize: 15, fontWeight: '600', color: colors.textPrimary, marginBottom: 8, marginTop: 12 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 14, fontSize: 16, marginBottom: 8, backgroundColor: colors.white },
  error: { color: colors.danger, fontSize: 13, marginBottom: 8 },
  btnPrimary: { backgroundColor: colors.brandPrimary, padding: 16, borderRadius: 10, alignItems: 'center', marginTop: 12 },
  btnPrimaryText: { color: colors.white, fontSize: 16, fontWeight: '700' },

  expiredBox: { backgroundColor: colors.warningBg, padding: 16, borderRadius: 10, marginBottom: 16, borderWidth: 1, borderColor: colors.warningBorder },
  expiredTitle: { fontSize: 16, fontWeight: '700', color: colors.warningText },
  expiredMsg: { fontSize: 14, color: colors.warningText, marginTop: 4 },

  toast: { backgroundColor: colors.success, padding: 14, margin: 16, borderRadius: 10, alignItems: 'center' },
  toastText: { color: colors.white, fontSize: 14, fontWeight: '600' },

  pushSection: { padding: 16 },
  btnNotify: { backgroundColor: colors.accent, padding: 14, borderRadius: 10, alignItems: 'center' },
  btnNotifyText: { color: colors.white, fontSize: 14, fontWeight: '700' },
  pushEnabled: { margin: 16, backgroundColor: colors.successBg, padding: 12, borderRadius: 10, alignItems: 'center' },
  pushEnabledText: { color: colors.successText, fontSize: 13, fontWeight: '500' },

  logSection: { marginHorizontal: 16, marginTop: 4, marginBottom: 8, backgroundColor: colors.white, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12 },
  logHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  logActionRow: { flexDirection: 'row', gap: 8 },
  logActionBtn: { backgroundColor: colors.brandPrimaryLight, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  logActionBtnText: { color: colors.brandPrimary, fontSize: 12, fontWeight: '700' },
  logClearBtn: { backgroundColor: colors.dangerBg, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  logClearBtnText: { color: colors.dangerText, fontSize: 12, fontWeight: '700' },
  logHint: { marginTop: 8, marginBottom: 10, color: colors.textSecondary, fontSize: 12 },
  logEmpty: { color: colors.textSecondary, fontSize: 12 },
  logItem: { backgroundColor: colors.bg, borderRadius: 8, padding: 8, marginBottom: 8 },
  logMeta: { fontSize: 11, color: colors.textSecondary, fontWeight: '600' },
  logMessage: { fontSize: 13, color: colors.textPrimary, marginTop: 2 },
  logDetails: { fontSize: 11, color: colors.textPrimary, marginTop: 4 },

  statsRow: { flexDirection: 'row', margin: 16, gap: 10 },
  statBox: { flex: 1, backgroundColor: colors.white, padding: 16, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  statNum: { fontSize: 24, fontWeight: '800', color: colors.textPrimary },
  statLabel: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },

  section: { marginHorizontal: 16, marginTop: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginBottom: 12 },

  chairCard: { borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1 },
  chairOccupied: { backgroundColor: colors.brandPrimaryLight, borderColor: colors.brandPrimaryBorder },
  chairEmpty: { backgroundColor: colors.white, borderColor: colors.border },
  chairsLoader: { backgroundColor: colors.white, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  chairsLoaderText: { fontSize: 14, color: colors.textSecondary },
  chairHeader: { marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chairLabel: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  chairBarberName: { fontSize: 13, color: colors.textSecondary, fontStyle: 'italic' },
  chairBody: {},
  chairCustomer: { marginBottom: 12 },
  chairToken: { fontFamily: fontFamilies.display, fontSize: typography.size.display, fontWeight: typography.weight.extrabold, color: colors.brandPrimary, letterSpacing: typography.tracking.wide },
  chairName: { fontSize: 16, color: colors.textPrimary, marginTop: 4 },
  chairEmptyText: { fontSize: 15, color: colors.textMuted },
  chairProcessing: { marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  chairProcessingText: { fontSize: 13, color: colors.textSecondary, fontStyle: 'italic' },
  chairActions: { flexDirection: 'row', gap: 8 },
  btnStart: { backgroundColor: colors.info, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  btnSkip: { backgroundColor: colors.warning, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  btnDone: { backgroundColor: colors.success, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  btnDisabled: { opacity: 0.5 },
  btnActionText: { color: colors.white, fontSize: 13, fontWeight: '700' },
  btnCallNext: { backgroundColor: colors.brandPrimary, padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 8 },
  btnCallNextText: { color: colors.white, fontSize: 14, fontWeight: '700' },

  timerText: { fontSize: 12, color: colors.info, fontWeight: '600', marginTop: 4 },
  timerExpired: { color: colors.danger },
  serviceStarted: { fontSize: 12, color: colors.success, fontWeight: '600', marginTop: 4 },

  waitingItem: { flexDirection: 'row', backgroundColor: colors.white, padding: 14, borderRadius: 10, marginBottom: 8, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  waitingToken: { fontSize: 18, fontWeight: '700', color: colors.brandPrimary, width: 50 },
  waitingInfo: { flex: 1 },
  waitingName: { fontSize: 15, color: colors.textPrimary },
  waitingBarber: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  emptyText: { fontSize: 14, color: colors.textMuted, fontStyle: 'italic' },

  // Barber filter styles
  filterSection: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  filterLabel: { fontSize: 14, color: colors.textPrimary, marginRight: 8 },
  filterDropdown: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceAlt, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, flex: 1, justifyContent: 'space-between' },
  filterDropdownText: { fontSize: 14, color: colors.textPrimary },
  filterDropdownArrow: { fontSize: 10, color: colors.textSecondary, marginLeft: 8 },
  clearFilterBtn: { marginLeft: 10, backgroundColor: colors.dangerBg, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  clearFilterText: { fontSize: 12, color: colors.danger, fontWeight: '600' },

  // Barber picker modal styles
  pickerBox: { backgroundColor: colors.white, borderRadius: 16, padding: 20, width: '85%', maxWidth: 360, maxHeight: '70%' },
  pickerTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginBottom: 16, textAlign: 'center' },
  pickerList: { maxHeight: 300 },
  pickerItem: { padding: 14, borderRadius: 8, marginBottom: 8, backgroundColor: colors.bg },
  pickerItemSelected: { backgroundColor: colors.brandPrimary },
  pickerItemText: { fontSize: 15, color: colors.textPrimary },
  pickerItemTextSelected: { color: colors.white, fontWeight: '600' },
  pickerCancel: { padding: 14, borderRadius: 10, alignItems: 'center', backgroundColor: colors.surfaceAlt, marginTop: 12 },
  pickerCancelText: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },

  addRow: { flexDirection: 'row', gap: 10 },
  btnAdd: { backgroundColor: colors.success, paddingHorizontal: 20, paddingVertical: 14, borderRadius: 8 },
  btnAddText: { color: colors.white, fontSize: 14, fontWeight: '700' },

  // Add customer barber selection styles
  addBarberRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  addBarberLabel: { fontSize: 13, color: colors.textPrimary, marginRight: 8 },
  addBarberDropdown: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bg, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: colors.border, flex: 1, justifyContent: 'space-between' },
  addBarberDropdownText: { fontSize: 14, color: colors.textPrimary },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalBox: { backgroundColor: colors.white, borderRadius: 16, padding: 24, width: '85%', maxWidth: 360 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, marginBottom: 8, textAlign: 'center' },
  modalMsg: { fontSize: 15, color: colors.textSecondary, marginBottom: 20, textAlign: 'center' },
  modalBtns: { flexDirection: 'row', gap: 12 },
  mCancel: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center', backgroundColor: colors.surfaceAlt },
  mConfirm: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center', backgroundColor: colors.success },
  mConfirmDanger: { backgroundColor: colors.danger },
  mCancelText: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  mConfirmText: { color: colors.white, fontSize: 15, fontWeight: '600' },
});
