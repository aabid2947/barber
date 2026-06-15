import { Feather } from '@expo/vector-icons';
import React, { useState, useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
  Stepper,
  TextField,
  Toast,
  useToast,
} from '../src/components/ui';
import { palette, radius, space, type } from '../src/theme/tokens';

const EXPO_PUBLIC_BACKEND_URL = getBackendBaseUrl();
const ADMIN_AUTH_KEY = '@admin_authed';
const ADMIN_SHOPS_CACHE_KEY = '@admin_shops_cache_v1';

interface Shop {
  id: string;
  shopId: string;
  name: string;
  username: string;
  password?: string;
  openTime: string;
  closeTime: string;
  waitingTimer: number;
  activeBarbers: number;
  isOpen: boolean;
}

interface ShopStats {
  total: number;
  completed: number;
  serving: number;
  waiting: number;
  left: number;
  skipped: number;
}

interface Barber {
  id: string;
  name: string;
  chairNumber: number;
  isActive: boolean;
}

export default function Admin() {
  // Quiet floating confirmation banner replaces the old inline toast. All existing
  // showToast(...) call sites + messages are preserved verbatim.
  const { toast, showToast } = useToast();
  const [isAuth, setIsAuth] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loading, setLoading] = useState(true);

  // Shops list
  const [shops, setShops] = useState<Shop[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newShop, setNewShop] = useState({
    shopId: '',
    name: '',
    username: '',
    password: '',
    openTime: '9:00 AM',
    closeTime: '10:00 PM',
    waitingTimer: 15,
    activeBarbers: 1,
  });

  // Shop detail view
  const [selectedShop, setSelectedShop] = useState<Shop | null>(null);
  const [shopStats, setShopStats] = useState<ShopStats | null>(null);
  const [shopDailyStats, setShopDailyStats] = useState<any[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [editShopData, setEditShopData] = useState<any>(null);
  const [tokenToRemove, setTokenToRemove] = useState('');
  const [showRemoveTokenModal, setShowRemoveTokenModal] = useState(false);
  const [showResetDayModal, setShowResetDayModal] = useState(false);
  const [showResetSessionModal, setShowResetSessionModal] = useState(false);
  const [showDeleteShopModal, setShowDeleteShopModal] = useState(false);

  // Barber management state
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [showAddBarberModal, setShowAddBarberModal] = useState(false);
  const [newBarberName, setNewBarberName] = useState('');

  // Tracks in-flight action keys so any button that triggered a network call can immediately
  // disable itself and render a loader. Shared across all handlers for consistency.
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const isBusy = (key: string) => busy.has(key);
  const markBusy = (key: string) => setBusy(prev => {
    const next = new Set(prev);
    next.add(key);
    return next;
  });
  const clearBusy = (key: string) => setBusy(prev => {
    if (!prev.has(key)) return prev;
    const next = new Set(prev);
    next.delete(key);
    return next;
  });

  useEffect(() => { checkAuth(); }, []);
  useEffect(() => { if (isAuth) fetchShops(); }, [isAuth]);
  useEffect(() => {
    if (selectedShop) {
      fetchShopStats(selectedShop.shopId);
      fetchShopDailyStats(selectedShop.shopId);
      fetchShopBarbers(selectedShop.shopId);
    }
  }, [selectedShop]);

  const checkAuth = async () => {
    try {
      const authed = await AsyncStorage.getItem(ADMIN_AUTH_KEY);
      if (authed === 'true') setIsAuth(true);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleLogin = async () => {
    setLoginError('');
    if (!username || !password) {
      setLoginError('Enter username and password');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${EXPO_PUBLIC_BACKEND_URL}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const d = await res.json();
      if (d.success) {
        await AsyncStorage.setItem(ADMIN_AUTH_KEY, 'true');
        setIsAuth(true);
      } else {
        setLoginError('Invalid credentials');
      }
    } catch (e) {
      setLoginError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await AsyncStorage.removeItem(ADMIN_AUTH_KEY);
    await AsyncStorage.removeItem(ADMIN_SHOPS_CACHE_KEY);
    setIsAuth(false);
    setSelectedShop(null);
  };

  const fetchShops = async () => {
    // 1) Hydrate from cache so the shops list renders without waiting on the network.
    try {
      const cached = await AsyncStorage.getItem(ADMIN_SHOPS_CACHE_KEY);
      if (cached) {
        const parsed: Shop[] = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setShops(prev => (prev.length > 0 ? prev : parsed));
        }
      }
    } catch (e) {
      // Corrupt cache is non-fatal — the network fetch below will overwrite it.
    }

    // 2) Refresh from network. Reconciles against cached list when it arrives.
    //    fetchWithRetry handles timeout + backoff retries on slow/flaky networks.
    try {
      const res = await fetchWithRetry(`${EXPO_PUBLIC_BACKEND_URL}/api/admin/shops`);
      if (res.ok) {
        const d = await res.json();
        const fresh: Shop[] = d.shops || [];
        setShops(fresh);
        AsyncStorage.setItem(ADMIN_SHOPS_CACHE_KEY, JSON.stringify(fresh)).catch(() => {});
      }
    } catch (e) { console.error(e); }
  };

  const fetchShopStats = async (shopId: string) => {
    try {
      const res = await fetch(`${EXPO_PUBLIC_BACKEND_URL}/api/admin/shop/${shopId}/today-stats`);
      if (res.ok) {
        const d = await res.json();
        setShopStats(d);
      }
    } catch (e) { console.error(e); }
  };

  const fetchShopDailyStats = async (shopId: string) => {
    try {
      const res = await fetch(`${EXPO_PUBLIC_BACKEND_URL}/api/admin/shop/${shopId}/daily-stats`);
      if (res.ok) {
        const d = await res.json();
        setShopDailyStats(d.days || []);
      }
    } catch (e) { console.error(e); }
  };

  const fetchShopBarbers = async (shopId: string) => {
    try {
      const res = await fetch(`${EXPO_PUBLIC_BACKEND_URL}/api/shop/${shopId}/barbers`);
      if (res.ok) {
        const d = await res.json();
        setBarbers(d.barbers || []);
      }
    } catch (e) { console.error(e); }
  };

  const handleAddBarber = async () => {
    if (!selectedShop || !newBarberName.trim()) {
      showToast('❌ Enter barber name');
      return;
    }
    if (isBusy('add-barber')) return;
    markBusy('add-barber');
    try {
      const res = await fetch(`${EXPO_PUBLIC_BACKEND_URL}/api/shop/${selectedShop.shopId}/barbers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newBarberName.trim() }),
      });
      if (res.ok) {
        const d = await res.json();
        showToast(`✅ Barber "${d.name}" added (Chair ${d.chairNumber})`);
        setShowAddBarberModal(false);
        setNewBarberName('');
        fetchShopBarbers(selectedShop.shopId);
      } else {
        const e = await res.json();
        showToast(`❌ ${e.detail}`);
      }
    } catch (e) { showToast('❌ Network error'); }
    finally { clearBusy('add-barber'); }
  };

  const handleDeleteBarber = async (barberId: string, barberName: string) => {
    if (!selectedShop) return;
    const key = `delete-barber:${barberId}`;
    if (isBusy(key)) return;
    markBusy(key);
    try {
      const res = await fetch(`${EXPO_PUBLIC_BACKEND_URL}/api/shop/${selectedShop.shopId}/barbers/${barberId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        showToast(`✅ Barber "${barberName}" removed`);
        fetchShopBarbers(selectedShop.shopId);
      } else {
        showToast('❌ Failed to delete barber');
      }
    } catch (e) { showToast('❌ Network error'); }
    finally { clearBusy(key); }
  };

  const handleCreateShop = async () => {
    if (!newShop.shopId || !newShop.name || !newShop.username || !newShop.password) {
      showToast('❌ Fill all required fields');
      return;
    }
    if (isBusy('create-shop')) return;
    markBusy('create-shop');
    try {
      const res = await fetch(`${EXPO_PUBLIC_BACKEND_URL}/api/admin/shops`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newShop),
      });
      if (res.ok) {
        showToast(`✅ Shop "${newShop.name}" created`);
        setShowCreateModal(false);
        setNewShop({ shopId: '', name: '', username: '', password: '', openTime: '9:00 AM', closeTime: '10:00 PM', waitingTimer: 15, activeBarbers: 1 });
        fetchShops();
      } else {
        const e = await res.json();
        showToast(`❌ ${e.detail}`);
      }
    } catch (e) { showToast('❌ Network error'); }
    finally { clearBusy('create-shop'); }
  };

  const handleUpdateShop = async () => {
    if (!editShopData || !selectedShop) return;
    if (isBusy('update-shop')) return;
    markBusy('update-shop');
    try {
      const res = await fetch(`${EXPO_PUBLIC_BACKEND_URL}/api/admin/shops/${selectedShop.shopId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editShopData),
      });
      if (res.ok) {
        showToast('✅ Shop updated');
        setEditMode(false);
        fetchShops();
        // Update selectedShop with new data
        setSelectedShop({ ...selectedShop, ...editShopData });
      } else {
        const e = await res.json();
        showToast(`❌ ${e.detail}`);
      }
    } catch (e) { showToast('❌ Network error'); }
    finally { clearBusy('update-shop'); }
  };

  const handleDeleteShop = async () => {
    if (!selectedShop) return;
    if (isBusy('delete-shop')) return;
    markBusy('delete-shop');
    try {
      const res = await fetch(`${EXPO_PUBLIC_BACKEND_URL}/api/admin/shops/${selectedShop.shopId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        showToast('✅ Shop deleted');
        setShowDeleteShopModal(false);
        setSelectedShop(null);
        fetchShops();
      } else {
        showToast('❌ Failed to delete');
      }
    } catch (e) { showToast('❌ Network error'); }
    finally { clearBusy('delete-shop'); }
  };

  const handleToggleShopStatus = async () => {
    if (!selectedShop) return;
    if (isBusy('toggle-shop')) return;
    markBusy('toggle-shop');
    const endpoint = selectedShop.isOpen ? 'close' : 'open';
    try {
      const res = await fetch(`${EXPO_PUBLIC_BACKEND_URL}/api/shop/${selectedShop.shopId}/${endpoint}`, {
        method: 'POST',
      });
      if (res.ok) {
        showToast(`✅ Shop ${selectedShop.isOpen ? 'closed' : 'opened'}`);
        setSelectedShop({ ...selectedShop, isOpen: !selectedShop.isOpen });
        fetchShops();
      }
    } catch (e) { showToast('❌ Network error'); }
    finally { clearBusy('toggle-shop'); }
  };

  const handleResetDay = async () => {
    if (!selectedShop) return;
    if (isBusy('reset-day')) return;
    markBusy('reset-day');
    try {
      const res = await fetch(`${EXPO_PUBLIC_BACKEND_URL}/api/queue/${selectedShop.shopId}/reset-day`, {
        method: 'POST',
      });
      if (res.ok) {
        showToast('✅ Day reset for this shop');
        setShowResetDayModal(false);
        fetchShopStats(selectedShop.shopId);
      }
    } catch (e) { showToast('❌ Network error'); }
    finally { clearBusy('reset-day'); }
  };

  const handleResetSession = async () => {
    if (!selectedShop) return;
    if (isBusy('reset-session')) return;
    markBusy('reset-session');
    try {
      const res = await fetch(`${EXPO_PUBLIC_BACKEND_URL}/api/shop/${selectedShop.shopId}/reset-session`, {
        method: 'POST',
      });
      if (res.ok) {
        showToast('✅ Barber session reset');
        setShowResetSessionModal(false);
      }
    } catch (e) { showToast('❌ Network error'); }
    finally { clearBusy('reset-session'); }
  };

  const handleRemoveToken = async () => {
    if (!selectedShop || !tokenToRemove) return;
    const tokenNum = parseInt(tokenToRemove);
    if (!tokenNum) { showToast('❌ Enter valid token number'); return; }
    if (isBusy('remove-token')) return;
    markBusy('remove-token');
    try {
      const res = await fetch(`${EXPO_PUBLIC_BACKEND_URL}/api/queue/${selectedShop.shopId}/remove-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenNumber: tokenNum }),
      });
      if (res.ok) {
        showToast(`✅ Token #${tokenNum} removed`);
        setShowRemoveTokenModal(false);
        setTokenToRemove('');
        fetchShopStats(selectedShop.shopId);
      } else {
        const e = await res.json();
        showToast(`❌ ${e.detail}`);
      }
    } catch (e) { showToast('❌ Network error'); }
    finally { clearBusy('remove-token'); }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', weekday: 'short' });
  };

  // Loading state
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={palette.accent} />
      </View>
    );
  }

  // ==========================================================================
  // Login screen (Username + Password only)
  // ==========================================================================
  if (!isAuth) {
    return (
      <>
        <Toast message={toast} />
        <Screen>
          <ScreenHeader
            eyebrow="Quevix · Smart Queue"
            title="Admin Panel"
            subtitle="Sign in to manage shops, barbers and live queues."
          />

          <Card level="md" style={{ gap: space.lg }}>
            <TextField
              label="Admin username"
              value={username}
              onChangeText={(t) => { setUsername(t); setLoginError(''); }}
              placeholder="Enter username"
              autoCapitalize="none"
            />
            <TextField
              label="Password"
              value={password}
              onChangeText={(t) => { setPassword(t); setLoginError(''); }}
              placeholder="Enter password"
              secureTextEntry
            />
            {loginError ? (
              <View style={styles.errorRow}>
                <Feather name="alert-circle" size={15} color={palette.dangerRose} />
                <Text style={styles.errorText}>{loginError}</Text>
              </View>
            ) : null}
            <Button
              label="Log in"
              icon="log-in"
              size="lg"
              fullWidth
              onPress={handleLogin}
              style={{ marginTop: space.sm }}
            />
          </Card>
        </Screen>
      </>
    );
  }

  // ==========================================================================
  // Shop Detail View
  // ==========================================================================
  if (selectedShop) {
    return (
      <>
        <Toast message={toast} />
        <Screen>
          <PressableScale onPress={() => { setSelectedShop(null); setEditMode(false); }} style={styles.backChip}>
            <Feather name="chevron-left" size={18} color={palette.accentInk} />
            <Text style={styles.backText}>All shops</Text>
          </PressableScale>

          <ScreenHeader
            eyebrow={`ID · ${selectedShop.shopId}`}
            title={selectedShop.name}
            right={<Pill label={selectedShop.isOpen ? 'Open' : 'Closed'} tone={selectedShop.isOpen ? 'teal' : 'neutral'} dot={selectedShop.isOpen} />}
          />

          {/* Shop Status Card */}
          <Card level="md">
            <View style={styles.kv}>
              <KvRow label="Status" value={selectedShop.isOpen ? 'OPEN' : 'CLOSED'} tone={selectedShop.isOpen ? palette.okGreen : palette.dangerRose} />
              <KvRow label="Shop ID" value={selectedShop.shopId} />
              <KvRow label="Hours" value={`${selectedShop.openTime} - ${selectedShop.closeTime}`} />
              <KvRow label="Timer" value={`${selectedShop.waitingTimer} mins`} />
              <KvRow label="Barbers" value={`${selectedShop.activeBarbers}`} />
              <KvRow label="QR URL" value={`/?shop=${selectedShop.shopId}`} tone={palette.accentInk} last />
            </View>
            <Button
              label={selectedShop.isOpen ? 'Close shop' : 'Open shop'}
              icon="power"
              variant={selectedShop.isOpen ? 'danger' : 'success'}
              size="lg"
              fullWidth
              loading={isBusy('toggle-shop')}
              onPress={handleToggleShopStatus}
              style={{ marginTop: space.lg }}
            />
          </Card>

          {/* Edit Shop Settings */}
          <Section
            title="Shop Settings"
            action={!editMode ? (
              <TextButton
                label="Edit"
                icon="edit-2"
                onPress={() => {
                  setEditMode(true);
                  setEditShopData({
                    name: selectedShop.name,
                    username: selectedShop.username,
                    password: '',
                    openTime: selectedShop.openTime,
                    closeTime: selectedShop.closeTime,
                    waitingTimer: selectedShop.waitingTimer,
                    activeBarbers: selectedShop.activeBarbers,
                  });
                }}
              />
            ) : undefined}
          >
            {!editMode ? (
              <Card level="sm">
                <Text style={type.bodyMuted}>Adjust the shop name, login, opening hours, the arrival timer and how many chairs run on the floor.</Text>
              </Card>
            ) : (
              <Card level="sm" style={{ gap: space.lg }}>
                <TextField
                  label="Shop name"
                  value={editShopData?.name || ''}
                  onChangeText={(t) => setEditShopData({ ...editShopData, name: t })}
                  placeholder="Shop Name"
                  autoCapitalize="words"
                />
                <TextField
                  label="Username"
                  value={editShopData?.username || ''}
                  onChangeText={(t) => setEditShopData({ ...editShopData, username: t })}
                  placeholder="Username"
                  autoCapitalize="none"
                />
                <TextField
                  label="New password (leave blank to keep)"
                  value={editShopData?.password || ''}
                  onChangeText={(t) => setEditShopData({ ...editShopData, password: t })}
                  placeholder="New password"
                  secureTextEntry
                />
                <View style={styles.twoCol}>
                  <View style={{ flex: 1 }}>
                    <TextField
                      label="Open time"
                      value={editShopData?.openTime || ''}
                      onChangeText={(t) => setEditShopData({ ...editShopData, openTime: t })}
                      placeholder="9:00 AM"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <TextField
                      label="Close time"
                      value={editShopData?.closeTime || ''}
                      onChangeText={(t) => setEditShopData({ ...editShopData, closeTime: t })}
                      placeholder="10:00 PM"
                    />
                  </View>
                </View>
                <View style={styles.twoCol}>
                  <View style={{ flex: 1 }}>
                    <Stepper
                      label="Arrival timer"
                      value={editShopData?.waitingTimer ?? 15}
                      onChange={(v) => setEditShopData({ ...editShopData, waitingTimer: v })}
                      min={0}
                      max={60}
                      suffix=" min"
                      offValue={0}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Stepper
                      label="Chairs"
                      value={editShopData?.activeBarbers ?? 1}
                      onChange={(v) => setEditShopData({ ...editShopData, activeBarbers: v })}
                      min={1}
                      max={10}
                    />
                  </View>
                </View>
                <View style={styles.twoCol}>
                  <View style={{ flex: 1 }}>
                    <Button label="Cancel" variant="secondary" fullWidth onPress={() => setEditMode(false)} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button label="Save" icon="check" variant="success" fullWidth loading={isBusy('update-shop')} onPress={handleUpdateShop} />
                  </View>
                </View>
              </Card>
            )}
          </Section>

          {/* Shop Actions */}
          <Section title="Shop Actions">
            <Card style={{ gap: space.lg }}>
              <View>
                <Button label="Reset barber session" icon="refresh-cw" variant="primary" fullWidth onPress={() => setShowResetSessionModal(true)} />
                <Text style={styles.helper}>Forces barbers to re-login for this shop</Text>
              </View>

              <View>
                <Text style={[type.label, { marginBottom: 8 }]}>Remove a token</Text>
                <View style={styles.removeRow}>
                  <View style={{ flex: 1 }}>
                    <TextField
                      value={tokenToRemove}
                      onChangeText={setTokenToRemove}
                      placeholder="Token #"
                      keyboardType="number-pad"
                    />
                  </View>
                  <Button label="Remove" variant="secondary" onPress={() => setShowRemoveTokenModal(true)} />
                </View>
              </View>

              <View>
                <Button label="Reset day" icon="rotate-ccw" variant="danger" fullWidth onPress={() => setShowResetDayModal(true)} />
                <Text style={styles.helper}>Clear all queue data for today</Text>
              </View>
            </Card>
          </Section>

          {/* Barber Management Section */}
          <Section
            title={`Barbers · ${barbers.length}`}
            action={<TextButton label="Add" icon="user-plus" onPress={() => setShowAddBarberModal(true)} />}
          >
            <Text style={[styles.helper, { marginTop: 0, marginBottom: space.md }]}>Add barbers for customers to choose from when joining queue</Text>
            {barbers.length > 0 ? (
              <View style={{ gap: space.sm }}>
                {barbers.map((barber) => (
                  <Card key={barber.id} level="sm" padding="md" style={styles.row}>
                    <Avatar name={barber.name} size={42} />
                    <View style={{ flex: 1 }}>
                      <Text style={type.body}>{barber.name}</Text>
                      <Text style={type.small}>Chair {barber.chairNumber}</Text>
                    </View>
                    <PressableScale
                      onPress={() => handleDeleteBarber(barber.id, barber.name)}
                      disabled={isBusy(`delete-barber:${barber.id}`)}
                      style={styles.removeBtn}
                    >
                      {isBusy(`delete-barber:${barber.id}`)
                        ? <ActivityIndicator color={palette.dangerRose} size="small" />
                        : <Feather name="x" size={18} color={palette.dangerRose} />}
                    </PressableScale>
                  </Card>
                ))}
              </View>
            ) : (
              <Card level="sm">
                <EmptyState icon="user-plus" title="No barbers added yet" hint="Add barbers so customers can pick a chair." />
              </Card>
            )}
          </Section>

          {/* Today's Summary */}
          <Section title="Today's Summary">
            {shopStats ? (
              <Card>
                <View style={styles.kv}>
                  <KvRow label="Total" value={`${shopStats.total || 0}`} />
                  <KvRow label="Completed" value={`${shopStats.completed || 0}`} tone={palette.okGreen} />
                  <KvRow label="Serving" value={`${shopStats.serving || 0}`} tone={palette.liveTeal} />
                  <KvRow label="Waiting" value={`${shopStats.waiting || 0}`} tone={palette.warnAmber} />
                  <KvRow label="Left / skipped" value={`${(shopStats.left || 0) + (shopStats.skipped || 0)}`} tone={palette.dangerRose} last />
                </View>
              </Card>
            ) : (
              <Card>
                <Text style={type.bodyMuted}>Loading...</Text>
              </Card>
            )}
          </Section>

          {/* Daily Stats */}
          <Section title="Daily Records">
            {shopDailyStats.length > 0 ? (
              <Card padding="lg">
                <View style={styles.dailyHeader}>
                  <Text style={styles.dailyHeaderText}>Date</Text>
                  <Text style={[styles.dailyHeaderText, styles.dailyNum]}>Total</Text>
                  <Text style={[styles.dailyHeaderText, styles.dailyNum]}>Done</Text>
                </View>
                {shopDailyStats.map((day, i) => (
                  <View key={i} style={[styles.dailyRow, i === shopDailyStats.length - 1 && { borderBottomWidth: 0 }]}>
                    <Text style={styles.dailyDate}>{formatDate(day.date)}</Text>
                    <Text style={[styles.dailyValue, styles.dailyNum]}>{day.total}</Text>
                    <Text style={[styles.dailyValue, styles.dailyNum, { color: palette.okGreen }]}>{day.completed}</Text>
                  </View>
                ))}
              </Card>
            ) : (
              <Card>
                <Text style={type.bodyMuted}>No data yet</Text>
              </Card>
            )}
          </Section>

          {/* Delete Shop */}
          <Section title="Danger zone">
            <PressableScale onPress={() => setShowDeleteShopModal(true)} style={styles.deleteRow}>
              <Feather name="trash-2" size={18} color={palette.dangerRose} />
              <Text style={styles.deleteText}>Delete this shop</Text>
              <Feather name="chevron-right" size={18} color={palette.dangerRose} style={{ marginLeft: 'auto' }} />
            </PressableScale>
          </Section>
        </Screen>

        {/* Confirm: reset barber session */}
        <ConfirmSheet
          visible={showResetSessionModal}
          onClose={() => setShowResetSessionModal(false)}
          title="Reset session?"
          message="All barbers for this shop will be logged out."
          confirmLabel="Reset"
          loading={isBusy('reset-session')}
          onConfirm={handleResetSession}
        />

        {/* Confirm: remove token */}
        <ConfirmSheet
          visible={showRemoveTokenModal}
          onClose={() => setShowRemoveTokenModal(false)}
          title="Remove token?"
          message={`Remove #${tokenToRemove} from queue?`}
          confirmLabel="Remove"
          destructive
          loading={isBusy('remove-token')}
          onConfirm={handleRemoveToken}
        />

        {/* Confirm: reset day */}
        <ConfirmSheet
          visible={showResetDayModal}
          onClose={() => setShowResetDayModal(false)}
          title="Reset day?"
          message="Clear ALL queue data for today for this shop?"
          confirmLabel="Reset"
          destructive
          loading={isBusy('reset-day')}
          onConfirm={handleResetDay}
        />

        {/* Confirm: delete shop */}
        <ConfirmSheet
          visible={showDeleteShopModal}
          onClose={() => setShowDeleteShopModal(false)}
          title="Delete shop?"
          message={`This will permanently delete "${selectedShop.name}" and all its data.`}
          confirmLabel="Delete"
          destructive
          loading={isBusy('delete-shop')}
          onConfirm={handleDeleteShop}
        />

        {/* Add Barber sheet */}
        <BottomSheet
          visible={showAddBarberModal}
          onClose={() => { setShowAddBarberModal(false); setNewBarberName(''); }}
          title="Add barber"
        >
          <TextField
            label="Barber name"
            value={newBarberName}
            onChangeText={setNewBarberName}
            placeholder="Enter barber name"
            autoCapitalize="words"
          />
          <Button
            label="Add barber"
            icon="user-plus"
            size="lg"
            fullWidth
            loading={isBusy('add-barber')}
            onPress={handleAddBarber}
            style={{ marginTop: space.xl }}
          />
        </BottomSheet>
      </>
    );
  }

  // ==========================================================================
  // Main Shop List View
  // ==========================================================================
  return (
    <>
      <Toast message={toast} />
      <Screen>
        <ScreenHeader
          eyebrow="Quevix · Admin"
          title="Manage"
          subtitle="Open hours, chairs, barbers and live queue controls."
          right={<TextButton label="Logout" icon="log-out" onPress={handleLogout} />}
        />

        <Button label="Create new shop" icon="plus" size="lg" fullWidth onPress={() => setShowCreateModal(true)} />

        <Section title={`Your shops · ${shops.length}`}>
          {shops.length > 0 ? (
            <View style={{ gap: space.md }}>
              {shops.map((shop) => (
                <PressableScale key={shop.id} onPress={() => setSelectedShop(shop)}>
                  <Card level="sm" style={{ gap: space.lg }}>
                    <View style={styles.row}>
                      <IconCircle name="home" size={46} bg={shop.isOpen ? palette.accentSoft : palette.surfaceMuted} color={shop.isOpen ? palette.accent : palette.inkFaint} />
                      <View style={{ flex: 1 }}>
                        <Text style={type.heading}>{shop.name}</Text>
                        <Text style={type.small}>ID · {shop.shopId}</Text>
                      </View>
                      <Pill label={shop.isOpen ? 'Open' : 'Closed'} tone={shop.isOpen ? 'teal' : 'neutral'} dot={shop.isOpen} />
                    </View>
                    <View style={styles.shopMeta}>
                      <MetaItem icon="clock" text={`${shop.openTime} – ${shop.closeTime}`} />
                      <MetaItem icon="watch" text={`${shop.waitingTimer} min`} />
                      <MetaItem icon="users" text={`${shop.activeBarbers} chair${shop.activeBarbers === 1 ? '' : 's'}`} />
                    </View>
                  </Card>
                </PressableScale>
              ))}
            </View>
          ) : (
            <Card>
              <EmptyState icon="home" title="No shops yet" hint="Create your first shop to get started." />
            </Card>
          )}
        </Section>
      </Screen>

      {/* Create Shop sheet */}
      <BottomSheet visible={showCreateModal} onClose={() => setShowCreateModal(false)} title="Create new shop" scroll>
        <View style={{ gap: space.lg }}>
          <TextField
            label="Shop ID (unique, no spaces)"
            value={newShop.shopId}
            onChangeText={(t) => setNewShop({ ...newShop, shopId: t.toLowerCase().replace(/\s/g, '') })}
            placeholder="e.g. style, royal"
            autoCapitalize="none"
          />
          <TextField
            label="Shop name"
            value={newShop.name}
            onChangeText={(t) => setNewShop({ ...newShop, name: t })}
            placeholder="e.g. Style Salon"
            autoCapitalize="words"
          />
          <TextField
            label="Login username"
            value={newShop.username}
            onChangeText={(t) => setNewShop({ ...newShop, username: t })}
            placeholder="Barber login username"
            autoCapitalize="none"
          />
          <TextField
            label="Login password"
            value={newShop.password}
            onChangeText={(t) => setNewShop({ ...newShop, password: t })}
            placeholder="Barber login password"
            secureTextEntry
          />
          <View style={styles.twoCol}>
            <View style={{ flex: 1 }}>
              <TextField
                label="Open time"
                value={newShop.openTime}
                onChangeText={(t) => setNewShop({ ...newShop, openTime: t })}
                placeholder="9:00 AM"
              />
            </View>
            <View style={{ flex: 1 }}>
              <TextField
                label="Close time"
                value={newShop.closeTime}
                onChangeText={(t) => setNewShop({ ...newShop, closeTime: t })}
                placeholder="10:00 PM"
              />
            </View>
          </View>
          <View style={styles.twoCol}>
            <View style={{ flex: 1 }}>
              <Stepper
                label="Arrival timer"
                value={newShop.waitingTimer}
                onChange={(v) => setNewShop({ ...newShop, waitingTimer: v })}
                min={0}
                max={60}
                suffix=" min"
                offValue={0}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Stepper
                label="Chairs"
                value={newShop.activeBarbers}
                onChange={(v) => setNewShop({ ...newShop, activeBarbers: v })}
                min={1}
                max={10}
              />
            </View>
          </View>
          <Button
            label="Create shop"
            icon="check"
            size="lg"
            fullWidth
            loading={isBusy('create-shop')}
            onPress={handleCreateShop}
            style={{ marginTop: space.sm }}
          />
        </View>
      </BottomSheet>
    </>
  );
}

// ---------------------------------------------------------------------------
// Small presentational bits
// ---------------------------------------------------------------------------
function MetaItem({ icon, text }: { icon: React.ComponentProps<typeof Feather>['name']; text: string }) {
  return (
    <View style={styles.metaItem}>
      <Feather name={icon} size={13} color={palette.inkFaint} />
      <Text style={styles.metaItemText}>{text}</Text>
    </View>
  );
}

function KvRow({ label, value, tone, last }: { label: string; value: string; tone?: string; last?: boolean }) {
  return (
    <View style={[styles.kvRow, last && { borderBottomWidth: 0 }]}>
      <Text style={type.bodyMuted}>{label}</Text>
      <Text style={[styles.kvValue, tone ? { color: tone } : null]}>{value}</Text>
    </View>
  );
}

function TextButton({ label, icon, onPress }: { label: string; icon: React.ComponentProps<typeof Feather>['name']; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} style={styles.textBtn} activeScale={0.95}>
      <Feather name={icon} size={15} color={palette.accentInk} />
      <Text style={styles.textBtnLabel}>{label}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: palette.canvas },

  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },

  backChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingRight: space.md,
    marginBottom: space.sm,
  },
  backText: { color: palette.accentInk, fontSize: 15, fontWeight: '700', marginLeft: 2 },

  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  errorText: { color: palette.dangerRose, fontSize: 13, fontWeight: '600' },
  helper: { color: palette.inkFaint, fontSize: 12.5, fontWeight: '500', marginTop: 6 },

  shopMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg, borderTopWidth: 1, borderTopColor: palette.line, paddingTop: space.lg },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaItemText: { color: palette.inkMuted, fontSize: 13, fontWeight: '600' },

  kv: {},
  kvRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: palette.line,
  },
  kvValue: { fontSize: 15.5, fontWeight: '800', color: palette.ink, fontVariant: ['tabular-nums'] },

  twoCol: { flexDirection: 'row', gap: space.md },

  removeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md },
  removeBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: palette.dangerRoseSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Daily records table
  dailyHeader: { flexDirection: 'row', paddingBottom: space.md, borderBottomWidth: 1.5, borderBottomColor: palette.lineStrong },
  dailyHeaderText: { flex: 1, ...type.label },
  dailyRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: palette.line },
  dailyDate: { flex: 1, fontSize: 14, fontWeight: '600', color: palette.ink },
  dailyValue: { flex: 1, fontSize: 15.5, fontWeight: '800', color: palette.ink, fontVariant: ['tabular-nums'] },
  dailyNum: { textAlign: 'right' },

  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: palette.dangerRoseSoft,
    borderRadius: radius.lg,
    paddingVertical: space.lg,
    paddingHorizontal: space.lg,
  },
  deleteText: { color: palette.dangerRose, fontSize: 15.5, fontWeight: '700' },

  textBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.sm, backgroundColor: palette.accentSoft },
  textBtnLabel: { color: palette.accentInk, fontSize: 14, fontWeight: '700' },
});
