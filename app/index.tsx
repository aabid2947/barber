import React, { useState, useEffect } from 'react';
import {
  Text,
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Modal,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { registerMobilePushDevice } from '../lib/mobileNotifications';
import { getBackendBaseUrl } from '../lib/backendUrl';
import { fetchWithRetry } from '../lib/fetchWithRetry';
import { colors, fontFamilies, typography } from '../lib/theme';

const EXPO_PUBLIC_BACKEND_URL = getBackendBaseUrl();
const MY_ENTRIES_KEY = '@my_queue_entries';
const JOIN_HISTORY_KEY = '@join_history';
const CUSTOMER_PUSH_TOKEN_KEY = '@customer_push_token';
const SHOPS_CACHE_KEY = '@shops_cache_v1';
const MAX_JOINS = 2;
const COOLDOWN_MIN = 10;

interface Shop {
  shopId: string;
  name: string;
  isOpen: boolean;
  openTime: string;
  closeTime: string;
}

interface BarberInfo {
  id: string;
  name: string;
  chairNumber: number;
  isActive: boolean;
}

interface QueueStatus {
  id: string;
  tokenNumber: number;
  name: string;
  status: string;
  servingNow: number[];
  peopleAhead: number;
  currentlyServing: number;
  shopId?: string;
  expiresAt?: string;
  serviceStartedAt?: string;
}

interface MyEntry {
  id: string;
  name: string;
  tokenNumber: number;
  shopId: string;
  shopName: string;
}

export default function Index() {
  // Bottom safe-area inset so the last item in each ScrollView clears the
  // Android 3-button nav / iOS home indicator.
  const insets = useSafeAreaInsets();
  // Shop selection state
  const [shops, setShops] = useState<Shop[]>([]);
  const [selectedShop, setSelectedShop] = useState<Shop | null>(null);
  const [loadingShops, setLoadingShops] = useState(true);

  // Barber selection state (optional)
  const [barbers, setBarbers] = useState<BarberInfo[]>([]);
  const [selectedBarber, setSelectedBarber] = useState<string | null>(null);
  const [showBarberPicker, setShowBarberPicker] = useState(false);

  // Queue state
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [joined, setJoined] = useState(false);
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [myEntries, setMyEntries] = useState<MyEntry[]>([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    fetchShops();
    loadMyEntries();
  }, []);

  useEffect(() => {
    let interval: any;
    if (joined && queueStatus) {
      interval = setInterval(refreshStatus, 15000); // Performance: 15s polling
    }
    return () => { if (interval) clearInterval(interval); };
  }, [joined, queueStatus]);

  // Fetch all shops — show cached list instantly, then refresh in the background.
  const fetchShops = async () => {
    // 1) Hydrate from cache so the UI renders without waiting on the network.
    try {
      const cached = await AsyncStorage.getItem(SHOPS_CACHE_KEY);
      if (cached) {
        const parsed: Shop[] = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setShops(parsed);
          setLoadingShops(false);
        }
      }
    } catch (e) {
      // Cache read/parse failure is non-fatal — fall through to the network fetch.
    }

    // 2) Refresh from network. If cache already rendered, this just reconciles.
    //    fetchWithRetry handles timeout + 2-retry backoff on slow/flaky networks.
    try {
      const res = await fetchWithRetry(`${EXPO_PUBLIC_BACKEND_URL}/api/admin/shops`);
      if (res.ok) {
        const data = await res.json();
        const fresh: Shop[] = data.shops || [];
        setShops(fresh);
        AsyncStorage.setItem(SHOPS_CACHE_KEY, JSON.stringify(fresh)).catch(() => {});
      }
    } catch (e) {
      console.error('Fetch shops error:', e);
    } finally {
      setLoadingShops(false);
    }
  };

  const loadMyEntries = async () => {
    try {
      const stored = await AsyncStorage.getItem(MY_ENTRIES_KEY);
      let entries: MyEntry[] = stored ? JSON.parse(stored) : [];

      // Validate entries - remove completed/left
      const validEntries: MyEntry[] = [];
      for (const entry of entries) {
        try {
          const res = await fetch(`${EXPO_PUBLIC_BACKEND_URL}/api/queue/status/${entry.id}`);
          if (res.ok) {
            const data = await res.json();
            if (data.status === 'waiting' || data.status === 'serving') {
              validEntries.push(entry);
            }
          }
        } catch (e) { /* skip */ }
      }

      setMyEntries(validEntries);
      await AsyncStorage.setItem(MY_ENTRIES_KEY, JSON.stringify(validEntries));

      // Auto-show the first active entry
      if (validEntries.length > 0 && !joined) {
        await viewEntry(validEntries[0]);
      }
    } catch (e) {
      console.error('Load entries error:', e);
    }
  };

  const saveMyEntries = async (entries: MyEntry[]) => {
    setMyEntries(entries);
    await AsyncStorage.setItem(MY_ENTRIES_KEY, JSON.stringify(entries));
  };

  const viewEntry = async (entry: MyEntry) => {
    try {
      const res = await fetch(`${EXPO_PUBLIC_BACKEND_URL}/api/queue/status/${entry.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'waiting' || data.status === 'serving') {
          setQueueStatus({ ...data, shopId: entry.shopId });
          setSelectedShop({ shopId: entry.shopId, name: entry.shopName, isOpen: true, openTime: '', closeTime: '' });
          setJoined(true);
          setErrorMessage('');
        }
      }
    } catch (e) {
      console.error('View entry error:', e);
    }
  };

  const handleSelectShop = async (shop: Shop) => {
    if (!shop.isOpen) {
      setErrorMessage(`${shop.name} is currently closed`);
      return;
    }
    setSelectedShop(shop);
    setErrorMessage('');
    
    // Fetch barbers for this shop
    try {
      const res = await fetch(`${EXPO_PUBLIC_BACKEND_URL}/api/shop/${shop.shopId}/barbers`);
      if (res.ok) {
        const data = await res.json();
        setBarbers(data.barbers || []);
      }
    } catch (e) {
      console.error('Fetch barbers error:', e);
    }
  };

  const handleBackToShops = () => {
    setSelectedShop(null);
    setName('');
    setErrorMessage('');
    setBarbers([]);
    setSelectedBarber(null);
  };

  const handleJoinQueue = async () => {
    if (!selectedShop) return;
    setErrorMessage('');
    
    if (!name.trim()) {
      setErrorMessage('Please enter your name');
      return;
    }

    // Rate limit check
    try {
      const historyStr = await AsyncStorage.getItem(JOIN_HISTORY_KEY);
      let history = historyStr ? JSON.parse(historyStr) : [];
      const now = new Date();
      const cutoff = new Date(now.getTime() - COOLDOWN_MIN * 60 * 1000);
      history = history.filter((ts: string) => new Date(ts) > cutoff);
      if (history.length >= MAX_JOINS) {
        const oldest = new Date(history[0]);
        const remaining = Math.ceil(COOLDOWN_MIN - (now.getTime() - oldest.getTime()) / 60000);
        setErrorMessage(`Joined ${MAX_JOINS} times already. Wait ${remaining} min.`);
        return;
      }
    } catch (e) { /* ignore */ }

    setLoading(true);
    try {
      const joinUrl = `${EXPO_PUBLIC_BACKEND_URL}/api/queue/join`;
      const joinBody = {
        name: name.trim(),
        shopId: selectedShop.shopId,
        barberId: selectedBarber || null
      };
      console.log(`[JOIN] Sending join request to: ${joinUrl}`);
      console.log(`[JOIN] Body: ${JSON.stringify(joinBody)}`);

      const res = await fetchWithRetry(joinUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(joinBody),
      });

      console.log(`[JOIN] Response status: ${res.status}`);

      if (res.ok) {
        const data = await res.json();
        console.log(`[JOIN] Join success: id=${data.id}, token=#${data.tokenNumber}, shopId=${data.shopId}`);

        // Flip UI immediately so the user sees their token — no awaits between here and render.
        setQueueStatus({ ...data, shopId: selectedShop.shopId });
        setJoined(true);
        setLoading(false);

        const newEntry: MyEntry = {
          id: data.id,
          name: data.name,
          tokenNumber: data.tokenNumber,
          shopId: selectedShop.shopId,
          shopName: selectedShop.name,
        };
        const updatedEntries = [...myEntries, newEntry];
        setMyEntries(updatedEntries);

        // Background work: push registration + persisted storage. Do NOT await — UI is already live.
        (async () => {
          try {
            await AsyncStorage.setItem(MY_ENTRIES_KEY, JSON.stringify(updatedEntries));

            const historyStr = await AsyncStorage.getItem(JOIN_HISTORY_KEY);
            const history = historyStr ? JSON.parse(historyStr) : [];
            history.push(new Date().toISOString());
            await AsyncStorage.setItem(JOIN_HISTORY_KEY, JSON.stringify(history));
          } catch (persistError) {
            console.error('[JOIN] Persist error:', persistError);
          }

          try {
            console.log(`[FCM] Registering customer device (background) for entryId=${data.id}`);
            const pushResult = await registerMobilePushDevice({
              userType: 'customer',
              shopId: selectedShop.shopId,
              entryId: data.id,
              backendUrl: EXPO_PUBLIC_BACKEND_URL,
            });
            if (pushResult.success && pushResult.token) {
              await AsyncStorage.setItem(CUSTOMER_PUSH_TOKEN_KEY, pushResult.token);
              console.log('[FCM] Customer push registered in background.');
            } else {
              console.warn('[FCM] Customer push registration skipped/failed:', pushResult.reason);
            }
          } catch (pushError) {
            console.error('[FCM] Customer push registration failed:', pushError);
          }
        })();

        return;
      } else if (res.status === 403) {
        setErrorMessage('Shop is currently closed');
      } else {
        setErrorMessage('Failed to join. Try again.');
      }
    } catch (e) {
      setErrorMessage('Network error. Check connection.');
    } finally {
      setLoading(false);
    }
  };

  const refreshStatus = async () => {
    if (!queueStatus) return;
    try {
      const res = await fetchWithRetry(`${EXPO_PUBLIC_BACKEND_URL}/api/queue/status/${queueStatus.id}`);
      if (res.ok) {
        const data = await res.json();
        setQueueStatus({ ...data, shopId: queueStatus.shopId });
        
        if (data.status === 'completed' || data.status === 'left' || data.status === 'skipped' || data.status === 'expired') {
          // Remove from my entries
          const updated = myEntries.filter(e => e.id !== data.id);
          await saveMyEntries(updated);
          
          if (updated.length > 0) {
            await viewEntry(updated[0]);
          } else {
            setJoined(false);
            setQueueStatus(null);
            setSelectedShop(null);
          }
        }
      }
    } catch (e) { console.error('Refresh error:', e); }
  };

  const confirmLeaveQueue = async () => {
    if (!queueStatus || leaving) return;
    setLeaving(true);
    try {
      const res = await fetchWithRetry(`${EXPO_PUBLIC_BACKEND_URL}/api/queue/${queueStatus.id}/leave`, { method: 'PATCH' });
      if (res.ok) {
        const updated = myEntries.filter(e => e.id !== queueStatus.id);
        await saveMyEntries(updated);
        setShowLeaveModal(false);

        if (updated.length > 0) {
          await viewEntry(updated[0]);
        } else {
          setJoined(false);
          setQueueStatus(null);
          setSelectedShop(null);
          setName('');
        }
      }
    } catch (e) { console.error('Leave error:', e); }
    finally { setLeaving(false); }
  };

  const handleNewEntry = () => {
    setJoined(false);
    setQueueStatus(null);
    setSelectedShop(null);
    setName('');
  };

  // STEP 1: Shop Selection Screen
  if (!selectedShop && !joined) {
    return (
      <ScrollView style={st.container} contentContainerStyle={[st.scrollPad, { paddingBottom: 16 + insets.bottom }]}>
        <View style={st.header}>
          <Text style={st.brand}>Quevix</Text>
          <Text style={st.brandSub}>Smart Queue Platform</Text>
        </View>

        <Text style={st.selectTitle}>Select Your Shop</Text>
        
        {errorMessage ? (
          <View style={st.errorBox}>
            <Text style={st.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        {shops.length > 0 ? (
          <View style={st.shopsList}>
            {shops.map((shop) => (
              <TouchableOpacity
                key={shop.shopId}
                style={[st.shopCard, !shop.isOpen && st.shopCardClosed]}
                onPress={() => handleSelectShop(shop)}
                disabled={!shop.isOpen}
              >
                <View style={st.shopCardContent}>
                  <Text style={st.shopName}>{shop.name}</Text>
                  <View style={[st.statusBadge, shop.isOpen ? st.statusOpen : st.statusClosed]}>
                    <Text style={st.statusText}>{shop.isOpen ? 'OPEN' : 'CLOSED'}</Text>
                  </View>
                </View>
                {shop.isOpen ? (
                  <Text style={st.shopHours}>Hours: {shop.openTime} - {shop.closeTime}</Text>
                ) : (
                  <Text style={st.shopClosedMsg}>Currently not accepting customers</Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
        ) : loadingShops ? (
          <View style={st.inlineLoader}>
            <ActivityIndicator size="small" color={colors.brandPrimary} />
            <Text style={st.loadingText}>Loading shops...</Text>
          </View>
        ) : (
          <View style={st.emptyBox}>
            <Text style={st.emptyText}>No shops available</Text>
          </View>
        )}

        {/* Show active entries */}
        {myEntries.length > 0 && (
          <View style={st.activeSection}>
            <Text style={st.activeSectionTitle}>Your Active Tokens</Text>
            {myEntries.map((entry) => (
              <TouchableOpacity
                key={entry.id}
                style={st.activeEntry}
                onPress={() => viewEntry(entry)}
              >
                <Text style={st.activeToken}>#{entry.tokenNumber}</Text>
                <View>
                  <Text style={st.activeName}>{entry.name}</Text>
                  <Text style={st.activeShop}>{entry.shopName}</Text>
                </View>
                <Text style={st.viewBtn}>View →</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Notification logs now in console */}
      </ScrollView>
    );
  }

  // STEP 2: Join Queue Form (after shop selected) — KeyboardAwareScrollView ensures the
  // name input stays visible when the keyboard slides up.
  if (selectedShop && !joined) {
    return (
      <KeyboardAwareScrollView
        style={st.container}
        contentContainerStyle={[st.scrollPad, { paddingBottom: 16 + insets.bottom }]}
        bottomOffset={24}
      >
        <TouchableOpacity style={st.backBtn} onPress={handleBackToShops}>
          <Text style={st.backBtnText}>← Back to Shops</Text>
        </TouchableOpacity>

        <View style={st.selectedShopCard}>
          <Text style={st.selectedShopName}>{selectedShop.name}</Text>
          <Text style={st.selectedShopHours}>Hours: {selectedShop.openTime} - {selectedShop.closeTime}</Text>
        </View>

        <View style={st.formCard}>
          <Text style={st.formTitle}>Join Queue</Text>
          <Text style={st.formLabel}>Your Name</Text>
          <TextInput
            style={st.input}
            value={name}
            onChangeText={(t) => { setName(t); setErrorMessage(''); }}
            placeholder="Enter your name"
            placeholderTextColor={colors.textPlaceholder}
            maxLength={50}
          />
          
          {/* Optional Barber Selection */}
          {barbers.length > 0 && (
            <View style={st.barberSection}>
              <Text style={st.formLabel}>Prefer a specific barber? (Optional)</Text>
              <TouchableOpacity 
                style={st.barberDropdown}
                onPress={() => setShowBarberPicker(true)}
              >
                <Text style={st.barberDropdownText}>
                  {selectedBarber 
                    ? barbers.find(b => b.id === selectedBarber)?.name || 'Select Barber'
                    : 'Any Available Barber'}
                </Text>
                <Text style={st.barberDropdownArrow}>▼</Text>
              </TouchableOpacity>
            </View>
          )}
          
          {errorMessage ? <Text style={st.formError}>{errorMessage}</Text> : null}
          <TouchableOpacity
            style={[st.joinBtn, loading && st.joinBtnDisabled]}
            onPress={handleJoinQueue}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={st.joinBtnText}>JOIN QUEUE</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Show other active entries */}
        {myEntries.length > 0 && (
          <View style={st.activeSection}>
            <Text style={st.activeSectionTitle}>Your Active Tokens</Text>
            {myEntries.map((entry) => (
              <TouchableOpacity
                key={entry.id}
                style={st.activeEntry}
                onPress={() => viewEntry(entry)}
              >
                <Text style={st.activeToken}>#{entry.tokenNumber}</Text>
                <View>
                  <Text style={st.activeName}>{entry.name}</Text>
                  <Text style={st.activeShop}>{entry.shopName}</Text>
                </View>
                <Text style={st.viewBtn}>View →</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Notification logs now in console */}

        {/* Barber Picker Modal */}
        <Modal visible={showBarberPicker} transparent animationType="fade">
          <View style={st.overlay}>
            <View style={st.pickerBox}>
              <Text style={st.pickerTitle}>Select Barber</Text>
              <ScrollView style={st.pickerList}>
                <TouchableOpacity 
                  style={[st.pickerItem, !selectedBarber && st.pickerItemSelected]}
                  onPress={() => { setSelectedBarber(null); setShowBarberPicker(false); }}
                >
                  <Text style={[st.pickerItemText, !selectedBarber && st.pickerItemTextSelected]}>
                    Any Available Barber
                  </Text>
                </TouchableOpacity>
                {barbers.filter(b => b.isActive).map((b) => (
                  <TouchableOpacity 
                    key={b.id}
                    style={[st.pickerItem, selectedBarber === b.id && st.pickerItemSelected]}
                    onPress={() => { setSelectedBarber(b.id); setShowBarberPicker(false); }}
                  >
                    <Text style={[st.pickerItemText, selectedBarber === b.id && st.pickerItemTextSelected]}>
                      {b.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <TouchableOpacity style={st.pickerCancel} onPress={() => setShowBarberPicker(false)}>
                <Text style={st.pickerCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </KeyboardAwareScrollView>
    );
  }

  // STEP 3: Queue Status (after joined)
  if (joined && queueStatus) {
    const isServing = queueStatus.status === 'serving';
    const servingText = queueStatus.servingNow?.length > 0 
      ? `Now Serving: #${queueStatus.servingNow.join(', #')}`
      : 'No one being served';

    // Calculate remaining timer for serving customers (expiresAt is UTC)
    let timerDisplay = null;
    let timerMinutes = 0;
    if (isServing && queueStatus.expiresAt && !queueStatus.serviceStartedAt) {
      // Add 'Z' to make it parse as UTC
      const expiresAtStr = queueStatus.expiresAt.endsWith('Z') ? queueStatus.expiresAt : queueStatus.expiresAt + 'Z';
      const expiresAt = new Date(expiresAtStr);
      const now = new Date();
      const diffMs = expiresAt.getTime() - now.getTime();
      timerMinutes = Math.max(0, Math.ceil(diffMs / 60000));
      if (timerMinutes > 0) {
        timerDisplay = `${timerMinutes} min to arrive`;
      } else {
        timerDisplay = 'Time expired!';
      }
    }

    return (
      <ScrollView style={st.container} contentContainerStyle={{ paddingBottom: insets.bottom }}>
        {/* Shop Name Header */}
        <View style={st.statusHeader}>
          <Text style={st.statusShopName}>{selectedShop?.name || 'Queue'}</Text>
        </View>

        {/* Token Card */}
        <View style={[st.tokenCard, isServing && st.tokenCardServing]}>
          <Text style={st.tokenLabel}>Your Token</Text>
          <Text style={st.tokenNumber}>#{queueStatus.tokenNumber}</Text>
          <Text style={st.tokenName}>{queueStatus.name}</Text>
          
          <View style={[st.statusIndicator, isServing ? st.statusServing : st.statusWaiting]}>
            <Text style={[st.statusIndicatorText, isServing && st.statusIndicatorTextServing]}>
              {isServing ? "IT'S YOUR TURN!" : 'WAITING'}
            </Text>
          </View>

          {isServing ? (
            <View style={st.servingInfo}>
              <Text style={st.goNowText}>Please proceed to the shop now!</Text>
              
              {/* Timer Display */}
              {timerDisplay && (
                <View style={[st.timerBox, timerMinutes === 0 && st.timerBoxExpired]}>
                  <Text style={st.timerIcon}>⏱</Text>
                  <Text style={[st.timerText, timerMinutes === 0 && st.timerTextExpired]}>
                    {timerDisplay}
                  </Text>
                </View>
              )}
              
              {queueStatus.serviceStartedAt && (
                <View style={st.serviceStartedBox}>
                  <Text style={st.serviceStartedText}>✓ Service in progress</Text>
                </View>
              )}
            </View>
          ) : (
            <View style={st.waitInfo}>
              <Text style={st.waitText}>{queueStatus.peopleAhead} people ahead of you</Text>
              <Text style={st.servingText}>{servingText}</Text>
            </View>
          )}
        </View>

        {/* Actions */}
        <View style={st.actions}>
          <TouchableOpacity style={st.leaveBtn} onPress={() => setShowLeaveModal(true)}>
            <Text style={st.leaveBtnText}>Leave Queue</Text>
          </TouchableOpacity>

          {myEntries.length < MAX_JOINS && (
            <TouchableOpacity style={st.newEntryBtn} onPress={handleNewEntry}>
              <Text style={st.newEntryBtnText}>Join Another Shop</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Other Active Entries */}
        {myEntries.length > 1 && (
          <View style={st.otherEntries}>
            <Text style={st.otherEntriesTitle}>Your Other Tokens</Text>
            {myEntries.filter(e => e.id !== queueStatus.id).map((entry) => (
              <TouchableOpacity
                key={entry.id}
                style={st.otherEntry}
                onPress={() => viewEntry(entry)}
              >
                <Text style={st.otherToken}>#{entry.tokenNumber}</Text>
                <Text style={st.otherShop}>{entry.shopName}</Text>
                <Text style={st.viewBtn}>View →</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Notification logs now in console */}

        {/* Leave Modal */}
        <Modal visible={showLeaveModal} transparent animationType="fade">
          <View style={st.overlay}>
            <View style={st.modalBox}>
              <Text style={st.modalTitle}>Leave Queue?</Text>
              <Text style={st.modalMsg}>
                Are you sure you want to leave? You'll lose your spot in line.
              </Text>
              <View style={st.modalBtns}>
                <TouchableOpacity style={st.modalCancel} onPress={() => setShowLeaveModal(false)}>
                  <Text style={st.modalCancelText}>Stay</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[st.modalConfirm, leaving && st.joinBtnDisabled]}
                  disabled={leaving}
                  onPress={confirmLeaveQueue}
                >
                  {leaving ? <ActivityIndicator color={colors.white} /> : <Text style={st.modalConfirmText}>Leave</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </ScrollView>
    );
  }

  return null;
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  scrollPad: { padding: 16, paddingTop: 56 },
  loadingText: { marginTop: 12, fontSize: 14, color: colors.textSecondary },

  header: { marginBottom: 24 },
  brand: { fontFamily: fontFamilies.display, fontSize: typography.size.display, fontWeight: typography.weight.extrabold, color: colors.textPrimary, letterSpacing: typography.tracking.wider },
  brandSub: { fontFamily: fontFamilies.display, fontSize: typography.size.base, color: colors.textSecondary, marginTop: 4, letterSpacing: typography.tracking.wide },

  selectTitle: { fontSize: 22, fontWeight: '700', color: colors.textPrimary, marginBottom: 16 },

  errorBox: { backgroundColor: colors.dangerBg, padding: 12, borderRadius: 10, marginBottom: 16 },
  errorText: { color: colors.dangerText, fontSize: 14 },

  shopsList: { gap: 12 },
  shopCard: { backgroundColor: colors.white, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: colors.border },
  shopCardClosed: { backgroundColor: colors.bg, opacity: 0.7 },
  shopCardContent: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  shopName: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  statusOpen: { backgroundColor: colors.successBg },
  statusClosed: { backgroundColor: colors.dangerBg },
  statusText: { fontSize: 12, fontWeight: '700' },
  shopHours: { fontSize: 13, color: colors.textSecondary },
  shopClosedMsg: { fontSize: 13, color: colors.danger, fontStyle: 'italic' },

  emptyBox: { backgroundColor: colors.white, borderRadius: 12, padding: 32, alignItems: 'center' },
  emptyText: { fontSize: 16, color: colors.textSecondary },
  inlineLoader: { backgroundColor: colors.white, borderRadius: 12, padding: 32, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 12 },

  activeSection: { marginTop: 24 },
  activeSectionTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginBottom: 12 },
  activeEntry: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.brandPrimaryLight, padding: 14, borderRadius: 10, marginBottom: 8 },
  activeToken: { fontFamily: fontFamilies.display, fontSize: typography.size.h2, fontWeight: typography.weight.extrabold, color: colors.brandPrimary, width: 60 },
  activeName: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  activeShop: { fontSize: 12, color: colors.textSecondary },
  viewBtn: { marginLeft: 'auto', color: colors.brandPrimary, fontWeight: '600' },

  backBtn: { marginBottom: 16 },
  backBtnText: { fontSize: 16, color: colors.brandPrimary, fontWeight: '600' },

  selectedShopCard: { backgroundColor: colors.brandPrimary, borderRadius: 12, padding: 20, marginBottom: 20 },
  selectedShopName: { fontSize: 22, fontWeight: '700', color: colors.white },
  selectedShopHours: { fontSize: 14, color: 'rgba(255,255,255,0.8)', marginTop: 4 },

  formCard: { backgroundColor: colors.white, borderRadius: 12, padding: 20, borderWidth: 1, borderColor: colors.border },
  formTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, marginBottom: 16 },
  formLabel: { fontSize: 15, fontWeight: '600', color: colors.textPrimary, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 14, fontSize: 16, marginBottom: 12 },
  formError: { color: colors.danger, fontSize: 13, marginBottom: 12 },
  joinBtn: { backgroundColor: colors.success, padding: 16, borderRadius: 10, alignItems: 'center' },
  joinBtnDisabled: { backgroundColor: colors.textSecondary },
  joinBtnText: { color: colors.white, fontSize: 16, fontWeight: '700' },

  // Barber selection styles
  barberSection: { marginTop: 8, marginBottom: 12 },
  barberDropdown: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 14 },
  barberDropdownText: { fontSize: 15, color: colors.textPrimary },
  barberDropdownArrow: { fontSize: 10, color: colors.textSecondary },

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

  statusHeader: { backgroundColor: colors.brandPrimary, padding: 20, paddingTop: 56 },
  statusShopName: { fontSize: 20, fontWeight: '700', color: colors.white, textAlign: 'center' },

  tokenCard: { margin: 16, backgroundColor: colors.white, borderRadius: 16, padding: 24, alignItems: 'center', borderWidth: 2, borderColor: colors.border },
  tokenCardServing: { backgroundColor: colors.successBg, borderColor: colors.success },
  tokenLabel: { fontSize: 14, color: colors.textSecondary, marginBottom: 8 },
  tokenNumber: { fontFamily: fontFamilies.display, fontSize: 64, fontWeight: typography.weight.extrabold, color: colors.brandPrimary, letterSpacing: typography.tracking.wider },
  tokenName: { fontSize: 18, color: colors.textPrimary, marginTop: 8 },
  statusIndicator: { marginTop: 16, paddingHorizontal: 24, paddingVertical: 8, borderRadius: 20 },
  statusWaiting: { backgroundColor: colors.warningBg },
  statusServing: { backgroundColor: colors.success },
  statusIndicatorText: { fontSize: 14, fontWeight: '700', color: colors.warningText },
  statusIndicatorTextServing: { color: colors.white },
  servingInfo: { alignItems: 'center', marginTop: 12 },
  goNowText: { fontSize: 15, color: colors.successText, fontWeight: '600', textAlign: 'center' },
  
  // Timer styles
  timerBox: { marginTop: 16, backgroundColor: colors.warningBg, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderColor: colors.warningBorder },
  timerBoxExpired: { backgroundColor: colors.dangerBg, borderColor: colors.dangerBg },
  timerIcon: { fontSize: 24, marginRight: 10 },
  timerText: { fontSize: 20, fontWeight: '800', color: colors.warningText },
  timerTextExpired: { color: colors.dangerText },
  serviceStartedBox: { marginTop: 12, backgroundColor: colors.successBg, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  serviceStartedText: { fontSize: 14, color: colors.successText, fontWeight: '600' },
  
  waitInfo: { marginTop: 16, alignItems: 'center' },
  waitText: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  servingText: { fontSize: 13, color: colors.textSecondary, marginTop: 4 },

  actions: { marginHorizontal: 16, marginTop: 16, gap: 12 },
  leaveBtn: { backgroundColor: colors.dangerBg, padding: 14, borderRadius: 10, alignItems: 'center' },
  leaveBtnText: { color: colors.danger, fontSize: 15, fontWeight: '600' },
  newEntryBtn: { backgroundColor: colors.brandPrimaryLight, padding: 14, borderRadius: 10, alignItems: 'center' },
  newEntryBtnText: { color: colors.brandPrimary, fontSize: 15, fontWeight: '600' },

  otherEntries: { marginHorizontal: 16, marginTop: 24 },
  otherEntriesTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginBottom: 12 },
  otherEntry: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bg, padding: 12, borderRadius: 8, marginBottom: 8 },
  otherToken: { fontSize: 18, fontWeight: '700', color: colors.brandPrimary, width: 50 },
  otherShop: { fontSize: 14, color: colors.textSecondary, flex: 1 },

  logCard: { marginHorizontal: 16, marginTop: 20, marginBottom: 12, backgroundColor: colors.white, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12 },
  logHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  logActions: { flexDirection: 'row', gap: 8 },
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

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalBox: { backgroundColor: colors.white, borderRadius: 16, padding: 24, width: '85%', maxWidth: 360 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, marginBottom: 8, textAlign: 'center' },
  modalMsg: { fontSize: 15, color: colors.textSecondary, marginBottom: 20, textAlign: 'center' },
  modalBtns: { flexDirection: 'row', gap: 12 },
  modalCancel: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center', backgroundColor: colors.success },
  modalConfirm: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center', backgroundColor: colors.danger },
  modalCancelText: { color: colors.white, fontSize: 15, fontWeight: '600' },
  modalConfirmText: { color: colors.white, fontSize: 15, fontWeight: '600' },
});
