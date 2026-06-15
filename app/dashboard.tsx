import { Feather } from '@expo/vector-icons';
import React, { useState, useEffect, useRef } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerMobilePushDevice, unregisterMobilePushDevice } from '../lib/mobileNotifications';
import { getBackendBaseUrl } from '../lib/backendUrl';
import { fetchWithRetry } from '../lib/fetchWithRetry';
import {
  Avatar,
  BottomSheet,
  Button,
  Card,
  ConfirmSheet,
  EmptyState,
  IconCircle,
  Pill,
  PressableScale,
  Screen,
  ScreenHeader,
  Section,
  Segmented,
  StatTile,
  TextField,
  Toast,
  useToast,
} from '../src/components/ui';
import { palette, radius, space, type } from '../src/theme/tokens';

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
  // Toast replaces the old custom banner — same trigger points / messages.
  const { toast, showToast } = useToast();

  const [isAuth, setIsAuth] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loginError, setLoginError] = useState('');
  const [data, setData] = useState<DashboardData | null>(null);
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
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={palette.accent} />
      </View>
    );
  }

  // Login screen (Username + Password only)
  if (!isAuth) {
    return (
      <>
        <Toast message={toast} />
        <Screen>
          <ScreenHeader
            eyebrow="Quevix · Smart Queue"
            title="Barber dashboard"
            subtitle="Sign in to manage your floor."
          />

          {sessionExpired && (
            <Card
              tint={palette.warnAmberSoft}
              borderColor={palette.warnAmberLine}
              level="flat"
              padding="lg"
              style={styles.expiredBox}
            >
              <Feather name="alert-triangle" size={18} color={palette.warnAmber} />
              <View style={{ flex: 1 }}>
                <Text style={[type.heading, { color: palette.warnAmber }]}>Session expired</Text>
                <Text style={[type.small, { color: palette.warnAmber, marginTop: 2 }]}>
                  Admin reset your session. Please login again.
                </Text>
              </View>
            </Card>
          )}

          <Card style={{ marginTop: space.xl }}>
            <TextField
              label="Username"
              value={username}
              onChangeText={(t) => { setUsername(t); setLoginError(''); }}
              placeholder="Enter username"
              autoCapitalize="none"
            />
            <View style={{ marginTop: space.xl }}>
              <TextField
                label="Password"
                value={password}
                onChangeText={(t) => { setPassword(t); setLoginError(''); }}
                placeholder="Enter password"
                secureTextEntry
              />
            </View>
            {loginError ? <Text style={styles.errorText}>{loginError}</Text> : null}
            <Button
              label="Login"
              icon="log-in"
              size="lg"
              fullWidth
              onPress={handleLogin}
              style={{ marginTop: space['2xl'] }}
            />
          </Card>
        </Screen>
      </>
    );
  }

  // When barber filter is ON, show only 1 chair for that barber; otherwise show all chairs.
  const chairsToShow = barberFilter ? 1 : (data?.activeBarbers || 1);
  // Get the chair number for filtered barber
  const filteredBarberChair = barberFilter
    ? data?.barbers?.find(b => b.id === barberFilter)?.chairNumber || 1
    : null;

  const filterOptions = data?.barbers
    ? [{ key: 'all', label: 'All barbers' }, ...data.barbers.map(b => ({ key: b.id, label: b.name }))]
    : [];

  const addBarberName = addBarberSelection
    ? data?.barbers?.find(b => b.id === addBarberSelection)?.name
    : null;

  // Dashboard — Screen's ScrollView (keyboardShouldPersistTaps="handled") keeps the
  // Add-Customer input reachable; BottomSheets handle their own keyboard avoidance.
  return (
    <>
      <Toast message={toast} />
      <Screen>
        <ScreenHeader
          eyebrow={`Quevix · ID ${shopId}`}
          title={shopName || 'Dashboard'}
          right={<Button label="Logout" variant="secondary" size="sm" icon="log-out" onPress={handleLogout} />}
        />

        {/* Push notifications */}
        {!barberPushEnabled ? (
          <Button
            label={
              barberPushLoading
                ? 'Enabling…'
                : Platform.OS === 'web'
                  ? 'Enable browser notifications'
                  : 'Enable mobile notifications'
            }
            variant="secondary"
            icon="bell"
            fullWidth
            loading={barberPushLoading}
            onPress={handleEnableBarberPush}
          />
        ) : (
          <Card tint={palette.liveTealSoft} borderColor={palette.liveTealLine} level="flat" padding="md" style={styles.pushEnabled}>
            <Feather name="bell" size={15} color={palette.liveTeal} />
            <Text style={[type.small, { color: palette.liveTeal, fontWeight: '700' }]}>Notifications enabled</Text>
          </Card>
        )}

        {/* Stats */}
        <View style={styles.stats}>
          <StatTile value={data?.activeBarbers || 0} label="Chairs" />
          <StatTile value={data?.servingCount || 0} label="Serving" tone="teal" />
          <StatTile value={data?.waitingCount || 0} label="Waiting" tone="amber" />
          <StatTile value={data?.completedCount || 0} label="Done" tone="accent" />
        </View>

        {/* Barber filter (only show if barbers exist) */}
        {data?.barbers && data.barbers.length > 0 && (
          <View style={{ marginTop: space['2xl'] }}>
            <Segmented
              options={filterOptions}
              value={barberFilter ?? 'all'}
              onChange={(k) => setBarberFilter(k === 'all' ? null : k)}
            />
          </View>
        )}

        {/* Chairs */}
        <Section
          title={barberFilter
            ? `Chair · ${data?.barbers?.find(b => b.id === barberFilter)?.name || 'Filtered'}`
            : 'Chairs'}
        >
          {!data ? (
            // First-ever login, no cache yet — don't guess at a chair count.
            <Card level="sm" style={styles.chairsLoader}>
              <ActivityIndicator size="small" color={palette.accent} />
              <Text style={type.bodyMuted}>Loading chairs…</Text>
            </Card>
          ) : (
            <View style={{ gap: space.md }}>
              {Array.from({ length: Math.max(1, chairsToShow) }, (_, i) => {
                // If barber filter is on, use that barber's chair number; otherwise sequential.
                const chairNum = barberFilter ? (filteredBarberChair as number) : (i + 1);

                // Resolve the barber that owns this chair. Without filter we look it up from
                // data.barbers by chairNumber so CALL NEXT can target this barber's queue.
                const chairBarberId = barberFilter
                  ?? (data?.barbers?.find(b => b.chairNumber === chairNum)?.id ?? null);
                const chairStartNextKey = startNextKeyFor(chairBarberId);
                const chairBarberName = data?.barbers?.find(b => b.chairNumber === chairNum)?.name ?? null;

                // Find serving entry for this chair
                let serving: ServingEntry | null = null;
                if (barberFilter) {
                  // When filtered, show the serving entry for this specific barber
                  serving = data?.servingList?.find(e => e.barberId === barberFilter) || null;
                } else {
                  serving = data?.servingList?.find(e => e.chairNumber === chairNum) || null;
                }

                // Calculate remaining time (expiresAt is in UTC)
                let timerDisplay: string | null = null;
                let timerMins = 0;
                if (serving?.expiresAt && !serving?.serviceStartedAt) {
                  // Add 'Z' to make it parse as UTC
                  const expiresAtStr = serving.expiresAt.endsWith('Z') ? serving.expiresAt : serving.expiresAt + 'Z';
                  const expiresAt = new Date(expiresAtStr);
                  const now = new Date();
                  const diffMs = expiresAt.getTime() - now.getTime();
                  timerMins = Math.max(0, Math.ceil(diffMs / 60000));
                  timerDisplay = timerMins > 0 ? `${timerMins} min left` : 'Timer expired';
                }

                const occupied = !!serving;
                const isPending = !!serving && pendingActions.has(serving.id);
                const callNextPending = pendingActions.has(chairStartNextKey);

                return (
                  <Card
                    key={`chair-${chairNum}-${i}`}
                    level={occupied ? 'md' : 'sm'}
                    tint={occupied ? palette.surface : palette.surfaceMuted}
                    style={occupied ? undefined : styles.chairEmpty}
                  >
                    <View style={styles.chairHead}>
                      <View style={styles.chairTag}>
                        <Feather name="scissors" size={14} color={occupied ? palette.accent : palette.inkFaint} />
                        <Text style={[styles.chairTagText, { color: occupied ? palette.ink : palette.inkMuted }]}>
                          Chair {chairNum}
                        </Text>
                      </View>
                      {serving?.barberId && serving?.barberName ? (
                        <Text style={styles.chairBarber}>{serving.barberName}</Text>
                      ) : chairBarberName ? (
                        <Text style={styles.chairBarber}>{chairBarberName}</Text>
                      ) : null}
                    </View>

                    {serving ? (
                      <>
                        <View style={styles.chairBody}>
                          <Text style={styles.chairToken}>#{serving.tokenNumber}</Text>
                          <View style={{ flex: 1 }}>
                            <Text style={type.heading}>{serving.name}</Text>
                            {serving.serviceStartedAt ? (
                              <View style={styles.inlineNote}>
                                <Feather name="check" size={13} color={palette.liveTeal} />
                                <Text style={[styles.inlineNoteText, { color: palette.liveTeal }]}>Service in progress</Text>
                              </View>
                            ) : timerDisplay ? (
                              <View style={styles.inlineNote}>
                                <Feather name="clock" size={13} color={timerMins === 0 ? palette.dangerRose : palette.warnAmber} />
                                <Text style={[styles.inlineNoteText, { color: timerMins === 0 ? palette.dangerRose : palette.warnAmber }]}>
                                  {timerDisplay}
                                </Text>
                              </View>
                            ) : null}
                          </View>
                        </View>
                        <View style={styles.chairActions}>
                          <View style={{ flex: 1 }}>
                            <Button
                              label="Skip"
                              variant="secondary"
                              icon="skip-forward"
                              fullWidth
                              loading={isPending}
                              disabled={isPending}
                              onPress={() => setConfirmModal({ visible: true, type: 'skip', entry: serving! })}
                            />
                          </View>
                          <View style={{ flex: 1.3 }}>
                            <Button
                              label="Done"
                              variant="success"
                              icon="check"
                              fullWidth
                              loading={isPending}
                              disabled={isPending}
                              onPress={() => setConfirmModal({ visible: true, type: 'done', entry: serving! })}
                            />
                          </View>
                        </View>
                        {isPending && (
                          <View style={styles.chairProcessing}>
                            <ActivityIndicator size="small" color={palette.accent} />
                            <Text style={styles.chairProcessingText}>Processing…</Text>
                          </View>
                        )}
                      </>
                    ) : (
                      <View style={styles.chairEmptyBody}>
                        <Text style={styles.chairEmptyText}>Open chair</Text>
                        {data && data.waitingCount > 0 ? (
                          <Button
                            label="Call next"
                            icon="arrow-up"
                            loading={callNextPending}
                            disabled={callNextPending}
                            onPress={() => handleStartNext(chairBarberId, chairNum)}
                          />
                        ) : (
                          <Text style={type.small}>No one waiting</Text>
                        )}
                      </View>
                    )}
                  </Card>
                );
              })}
            </View>
          )}
        </Section>

        {/* Waiting list */}
        <Section title={`Waiting · ${data?.waitingCount || 0}`}>
          {data?.waitingList?.length ? (
            <View style={{ gap: space.sm }}>
              {data.waitingList.map((e) => (
                <Card key={e.id} level="sm" padding="md" style={styles.waitRow}>
                  <View style={styles.waitToken}>
                    <Text style={styles.waitTokenText}>#{e.tokenNumber}</Text>
                  </View>
                  <Text style={[type.body, { flex: 1 }]}>{e.name}</Text>
                  {e.barberId && e.barberName
                    ? <Pill label={e.barberName} tone="accent" />
                    : <Pill label="Any barber" tone="neutral" />}
                </Card>
              ))}
            </View>
          ) : (
            <Card level="sm">
              <EmptyState icon="coffee" title="No one waiting" hint="The queue is clear right now." />
            </Card>
          )}
        </Section>

        {/* Add customer */}
        <Section title="Add a walk-in">
          <Card>
            <View style={styles.addRow}>
              <View style={{ flex: 1 }}>
                <TextField
                  value={addName}
                  onChangeText={setAddName}
                  placeholder="Customer name"
                  autoCapitalize="words"
                />
              </View>
              <Button
                label="Add"
                icon="plus"
                loading={pendingActions.has('add-customer')}
                disabled={pendingActions.has('add-customer')}
                onPress={handleAddCustomer}
              />
            </View>
            {/* Barber selection for Add Customer */}
            {data?.barbers && data.barbers.length > 0 && (
              <PressableScale onPress={() => setShowAddBarberPicker(true)} style={styles.assignRow}>
                <Feather name="user-check" size={16} color={palette.inkMuted} />
                <Text style={styles.assignText}>
                  {addBarberName ? `Assigned to ${addBarberName}` : 'Assign to a barber (optional)'}
                </Text>
                {addBarberSelection ? (
                  <PressableScale onPress={() => setAddBarberSelection(null)} hitSlop={8}>
                    <Feather name="x" size={18} color={palette.inkFaint} />
                  </PressableScale>
                ) : (
                  <Feather name="chevron-down" size={18} color={palette.inkFaint} />
                )}
              </PressableScale>
            )}
          </Card>
        </Section>
      </Screen>

      {/* Barber picker sheet (for filter) */}
      <BottomSheet visible={showBarberPicker} onClose={() => setShowBarberPicker(false)} title="Select barber" scroll>
        <PickerRow
          label="All barbers"
          leading={<IconCircle name="users" size={40} />}
          selected={!barberFilter}
          onPress={() => { setBarberFilter(null); setShowBarberPicker(false); }}
        />
        {data?.barbers?.map((b) => (
          <PickerRow
            key={b.id}
            label={b.name}
            sub={`Chair ${b.chairNumber}`}
            leading={<Avatar name={b.name} size={40} />}
            selected={barberFilter === b.id}
            onPress={() => { setBarberFilter(b.id); setShowBarberPicker(false); }}
          />
        ))}
      </BottomSheet>

      {/* Barber picker sheet (for adding customer) */}
      <BottomSheet visible={showAddBarberPicker} onClose={() => setShowAddBarberPicker(false)} title="Assign to barber" scroll>
        <PickerRow
          label="Any available barber"
          leading={<IconCircle name="users" size={40} />}
          selected={!addBarberSelection}
          onPress={() => { setAddBarberSelection(null); setShowAddBarberPicker(false); }}
        />
        {data?.barbers?.filter(b => b.isActive).map((b) => (
          <PickerRow
            key={b.id}
            label={b.name}
            sub={`Chair ${b.chairNumber}`}
            leading={<Avatar name={b.name} size={40} />}
            selected={addBarberSelection === b.id}
            onPress={() => { setAddBarberSelection(b.id); setShowAddBarberPicker(false); }}
          />
        ))}
      </BottomSheet>

      {/* Confirm done / start / skip */}
      <ConfirmSheet
        visible={confirmModal.visible}
        onClose={() => setConfirmModal({ visible: false, type: 'done' })}
        title={
          confirmModal.type === 'done'
            ? 'Mark as done?'
            : confirmModal.type === 'start'
              ? 'Start service?'
              : 'Skip customer?'
        }
        message={
          confirmModal.type === 'done'
            ? `Complete service for #${confirmModal.entry?.tokenNumber} (${confirmModal.entry?.name})?`
            : confirmModal.type === 'start'
              ? `Start service for #${confirmModal.entry?.tokenNumber}? This clears the waiting timer.`
              : `Skip #${confirmModal.entry?.tokenNumber} (${confirmModal.entry?.name})? They must take a new token.`
        }
        confirmLabel={
          confirmModal.type === 'done'
            ? 'Done'
            : confirmModal.type === 'start'
              ? 'Start'
              : 'Skip'
        }
        destructive={confirmModal.type === 'skip'}
        loading={!!confirmModal.entry && pendingActions.has(confirmModal.entry.id)}
        onConfirm={() => {
          const entry = confirmModal.entry;
          if (entry) {
            if (confirmModal.type === 'done') handleDone(entry.id, entry.tokenNumber);
            if (confirmModal.type === 'start') handleStart(entry.id, entry.tokenNumber);
            if (confirmModal.type === 'skip') handleSkip(entry.id, entry.tokenNumber);
          }
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Picker row (matches index.tsx PickerRow)
// ---------------------------------------------------------------------------
function PickerRow({
  label,
  sub,
  leading,
  selected,
  onPress,
}: {
  label: string;
  sub?: string;
  leading: React.ReactNode;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale onPress={onPress} style={[styles.pickerRow, selected && styles.pickerRowSelected]}>
      {leading}
      <View style={{ flex: 1 }}>
        <Text style={[type.body, selected && { color: palette.accentInk }]}>{label}</Text>
        {sub ? <Text style={type.small}>{sub}</Text> : null}
      </View>
      {selected ? (
        <Feather name="check-circle" size={22} color={palette.accent} />
      ) : (
        <View style={styles.radio} />
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: palette.canvas },

  errorText: { color: palette.dangerRose, fontSize: 13, fontWeight: '600', marginTop: 8 },

  expiredBox: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, marginTop: space.lg },

  pushEnabled: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },

  stats: { flexDirection: 'row', gap: space.sm, marginTop: space.xl },

  chairsLoader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.md },

  chairEmpty: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: palette.lineStrong },
  chairHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.md },
  chairTag: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  chairTagText: { fontSize: 13, fontWeight: '800', letterSpacing: 0.3, textTransform: 'uppercase' },
  chairBarber: { fontSize: 13.5, fontWeight: '600', color: palette.inkMuted },
  chairBody: { flexDirection: 'row', alignItems: 'center', gap: space.lg, marginBottom: space.lg },
  chairToken: { fontSize: 34, fontWeight: '800', color: palette.accent, fontVariant: ['tabular-nums'], letterSpacing: -1 },
  inlineNote: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  inlineNoteText: { fontSize: 13, fontWeight: '700' },
  chairActions: { flexDirection: 'row', gap: space.md },
  chairEmptyBody: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chairEmptyText: { fontSize: 15.5, fontWeight: '600', color: palette.inkFaint },
  chairProcessing: { marginTop: space.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  chairProcessingText: { fontSize: 13, color: palette.inkMuted, fontStyle: 'italic' },

  waitRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  waitToken: {
    minWidth: 52,
    height: 40,
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
    backgroundColor: palette.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waitTokenText: { color: palette.accentInk, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },

  addRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md },
  assignRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.md,
    paddingVertical: 12,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: palette.surfaceMuted,
  },
  assignText: { flex: 1, color: palette.inkMuted, fontSize: 14, fontWeight: '600' },

  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    marginBottom: space.xs,
  },
  pickerRowSelected: { backgroundColor: palette.accentSoft },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: palette.lineStrong },
});
