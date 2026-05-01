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
import { KeyboardAwareScrollView, KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { getBackendBaseUrl } from '../lib/backendUrl';
import { fetchWithRetry } from '../lib/fetchWithRetry';
import { colors, fontFamilies, typography } from '../lib/theme';

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
  // Bottom safe-area inset so the bottom of every ScrollView clears the
  // Android 3-button nav / iOS home indicator.
  const insets = useSafeAreaInsets();
  const [isAuth, setIsAuth] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');

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

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
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
    return <View style={st.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View>;
  }

  // Login screen (Username + Password only)
  if (!isAuth) {
    return (
      <KeyboardAwareScrollView
        style={st.container}
        contentContainerStyle={[st.scrollPad, { paddingBottom: 16 + insets.bottom }]}
        bottomOffset={24}
      >
        <View style={st.headerSection}>
          <Text style={st.brand}>Quevix</Text>
          <Text style={st.brandSub}>Smart Queue Platform</Text>
          <Text style={st.subtitle}>Admin Panel</Text>
        </View>
        <View style={st.card}>
          <Text style={st.cardLabel}>Admin Username</Text>
          <TextInput
            style={st.input}
            value={username}
            onChangeText={(t) => { setUsername(t); setLoginError(''); }}
            placeholder="Enter username"
            placeholderTextColor={colors.textPlaceholder}
            autoCapitalize="none"
          />
          <Text style={st.cardLabel}>Password</Text>
          <TextInput
            style={st.input}
            value={password}
            onChangeText={(t) => { setPassword(t); setLoginError(''); }}
            placeholder="Enter password"
            placeholderTextColor={colors.textPlaceholder}
            secureTextEntry
          />
          {loginError ? <Text style={st.errorText}>{loginError}</Text> : null}
          <TouchableOpacity style={st.btnPrimary} onPress={handleLogin}>
            <Text style={st.btnText}>LOGIN</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAwareScrollView>
    );
  }

  // Shop Detail View
  if (selectedShop) {
    return (
      <KeyboardAwareScrollView
        style={st.container}
        contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
        bottomOffset={24}
      >
        <View style={st.headerBar}>
          <TouchableOpacity onPress={() => { setSelectedShop(null); setEditMode(false); }}>
            <Text style={st.backBtn}>← Back</Text>
          </TouchableOpacity>
          <Text style={st.shopTitle}>{selectedShop.name}</Text>
        </View>

        {toast ? <View style={st.toast}><Text style={st.toastText}>{toast}</Text></View> : null}

        {/* Shop Status Card */}
        <View style={st.statusCard}>
          <View style={st.statusRow}>
            <Text style={st.statusLabel}>Status:</Text>
            <Text style={[st.statusValue, selectedShop.isOpen ? st.green : st.red]}>
              {selectedShop.isOpen ? 'OPEN' : 'CLOSED'}
            </Text>
          </View>
          <View style={st.statusRow}>
            <Text style={st.statusLabel}>Shop ID:</Text>
            <Text style={st.statusValue}>{selectedShop.shopId}</Text>
          </View>
          <View style={st.statusRow}>
            <Text style={st.statusLabel}>Hours:</Text>
            <Text style={st.statusValue}>{selectedShop.openTime} - {selectedShop.closeTime}</Text>
          </View>
          <View style={st.statusRow}>
            <Text style={st.statusLabel}>Timer:</Text>
            <Text style={st.statusValue}>{selectedShop.waitingTimer} mins</Text>
          </View>
          <View style={st.statusRow}>
            <Text style={st.statusLabel}>Barbers:</Text>
            <Text style={st.statusValue}>{selectedShop.activeBarbers}</Text>
          </View>
          <View style={st.statusRow}>
            <Text style={st.statusLabel}>QR URL:</Text>
            <Text style={[st.statusValue, st.qrUrl]}>/?shop={selectedShop.shopId}</Text>
          </View>

          <TouchableOpacity
            style={[st.btnToggle, selectedShop.isOpen ? st.btnDanger : st.btnSuccess, isBusy('toggle-shop') && st.btnDisabled]}
            disabled={isBusy('toggle-shop')}
            onPress={handleToggleShopStatus}
          >
            {isBusy('toggle-shop')
              ? <ActivityIndicator color={colors.white} />
              : <Text style={st.btnText}>{selectedShop.isOpen ? 'CLOSE SHOP' : 'OPEN SHOP'}</Text>}
          </TouchableOpacity>
        </View>

        {/* Edit Shop Settings */}
        <View style={st.section}>
          <Text style={st.sectionTitle}>Shop Settings</Text>
          {!editMode ? (
            <TouchableOpacity style={st.btnOutline} onPress={() => { 
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
            }}>
              <Text style={st.btnOutlineText}>EDIT SETTINGS</Text>
            </TouchableOpacity>
          ) : (
            <View style={st.editForm}>
              <Text style={st.formLabel}>Shop Name</Text>
              <TextInput
                style={st.input}
                value={editShopData?.name || ''}
                onChangeText={(t) => setEditShopData({ ...editShopData, name: t })}
                placeholder="Shop Name"
                placeholderTextColor={colors.textPlaceholder}
              />
              <Text style={st.formLabel}>Username</Text>
              <TextInput
                style={st.input}
                value={editShopData?.username || ''}
                onChangeText={(t) => setEditShopData({ ...editShopData, username: t })}
                placeholder="Username"
                placeholderTextColor={colors.textPlaceholder}
                autoCapitalize="none"
              />
              <Text style={st.formLabel}>New Password (leave blank to keep)</Text>
              <TextInput
                style={st.input}
                value={editShopData?.password || ''}
                onChangeText={(t) => setEditShopData({ ...editShopData, password: t })}
                placeholder="New password"
                placeholderTextColor={colors.textPlaceholder}
                secureTextEntry
              />
              <View style={st.row}>
                <View style={st.half}>
                  <Text style={st.formLabel}>Open Time</Text>
                  <TextInput
                    style={st.input}
                    value={editShopData?.openTime || ''}
                    onChangeText={(t) => setEditShopData({ ...editShopData, openTime: t })}
                    placeholder="9:00 AM"
                    placeholderTextColor={colors.textPlaceholder}
                  />
                </View>
                <View style={st.half}>
                  <Text style={st.formLabel}>Close Time</Text>
                  <TextInput
                    style={st.input}
                    value={editShopData?.closeTime || ''}
                    onChangeText={(t) => setEditShopData({ ...editShopData, closeTime: t })}
                    placeholder="10:00 PM"
                    placeholderTextColor={colors.textPlaceholder}
                  />
                </View>
              </View>
              <View style={st.row}>
                <View style={st.half}>
                  <Text style={st.formLabel}>Timer</Text>
                  <View style={st.timerControl}>
                    <TouchableOpacity 
                      style={[st.timerToggleBtn, editShopData?.waitingTimer === 0 ? st.timerOff : st.timerOn]}
                      onPress={() => {
                        if (editShopData?.waitingTimer === 0) {
                          setEditShopData({ ...editShopData, waitingTimer: 15 });
                        } else {
                          setEditShopData({ ...editShopData, waitingTimer: 0 });
                        }
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={st.timerToggleBtnText}>
                        {editShopData?.waitingTimer === 0 ? 'OFF' : `${editShopData?.waitingTimer || 15} min`}
                      </Text>
                    </TouchableOpacity>
                    {editShopData?.waitingTimer !== 0 && (
                      <View style={st.timerAdjust}>
                        <TouchableOpacity 
                          style={st.timerAdjustBtn}
                          onPress={() => {
                            const current = editShopData?.waitingTimer || 15;
                            if (current > 1) setEditShopData({ ...editShopData, waitingTimer: current - 1 });
                          }}
                        >
                          <Text style={st.timerAdjustText}>−</Text>
                        </TouchableOpacity>
                        <TouchableOpacity 
                          style={st.timerAdjustBtn}
                          onPress={() => {
                            const current = editShopData?.waitingTimer || 15;
                            if (current < 60) setEditShopData({ ...editShopData, waitingTimer: current + 1 });
                          }}
                        >
                          <Text style={st.timerAdjustText}>+</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </View>
                <View style={st.half}>
                  <Text style={st.formLabel}>Chairs (1-10)</Text>
                  <View style={st.chairSelector}>
                    <TouchableOpacity 
                      style={st.chairBtn}
                      onPress={() => {
                        const current = editShopData?.activeBarbers || 1;
                        if (current > 1) setEditShopData({ ...editShopData, activeBarbers: current - 1 });
                      }}
                    >
                      <Text style={st.chairBtnText}>−</Text>
                    </TouchableOpacity>
                    <Text style={st.chairCount}>{editShopData?.activeBarbers || 1}</Text>
                    <TouchableOpacity 
                      style={st.chairBtn}
                      onPress={() => {
                        const current = editShopData?.activeBarbers || 1;
                        if (current < 10) setEditShopData({ ...editShopData, activeBarbers: current + 1 });
                      }}
                    >
                      <Text style={st.chairBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
              <View style={st.editBtns}>
                <TouchableOpacity style={st.btnCancel} onPress={() => setEditMode(false)}>
                  <Text style={st.btnCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[st.btnSave, isBusy('update-shop') && st.btnDisabled]}
                  disabled={isBusy('update-shop')}
                  onPress={handleUpdateShop}
                >
                  {isBusy('update-shop') ? <ActivityIndicator color={colors.white} /> : <Text style={st.btnText}>SAVE</Text>}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* Shop Actions */}
        <View style={st.section}>
          <Text style={st.sectionTitle}>Shop Actions</Text>
          <TouchableOpacity style={st.btnWarning} onPress={() => setShowResetSessionModal(true)}>
            <Text style={st.btnText}>RESET BARBER SESSION</Text>
          </TouchableOpacity>
          <Text style={st.helper}>Forces barbers to re-login for this shop</Text>
          
          <View style={st.tokenRow}>
            <TextInput
              style={[st.input, { flex: 1 }]}
              value={tokenToRemove}
              onChangeText={setTokenToRemove}
              placeholder="Token #"
              placeholderTextColor={colors.textPlaceholder}
              keyboardType="number-pad"
            />
            <TouchableOpacity style={st.btnRemove} onPress={() => setShowRemoveTokenModal(true)}>
              <Text style={st.btnText}>REMOVE</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={st.btnDanger} onPress={() => setShowResetDayModal(true)}>
            <Text style={st.btnText}>RESET DAY</Text>
          </TouchableOpacity>
          <Text style={st.helper}>Clear all queue data for today</Text>
        </View>

        {/* Barber Management Section */}
        <View style={st.section}>
          <Text style={st.sectionTitle}>Barbers ({barbers.length})</Text>
          <Text style={st.helper}>Add barbers for customers to choose from when joining queue</Text>
          
          {barbers.length > 0 ? (
            <View style={st.barbersList}>
              {barbers.map((barber) => (
                <View key={barber.id} style={st.barberItem}>
                  <View style={st.barberInfo}>
                    <Text style={st.barberName}>{barber.name}</Text>
                    <Text style={st.barberChair}>Chair #{barber.chairNumber}</Text>
                  </View>
                  <TouchableOpacity
                    style={[st.barberDeleteBtn, isBusy(`delete-barber:${barber.id}`) && st.btnDisabled]}
                    disabled={isBusy(`delete-barber:${barber.id}`)}
                    onPress={() => handleDeleteBarber(barber.id, barber.name)}
                  >
                    {isBusy(`delete-barber:${barber.id}`)
                      ? <ActivityIndicator color={colors.danger} size="small" />
                      : <Text style={st.barberDeleteText}>Remove</Text>}
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : (
            <Text style={st.emptyBarbers}>No barbers added yet</Text>
          )}
          
          <TouchableOpacity style={st.btnAddBarber} onPress={() => setShowAddBarberModal(true)}>
            <Text style={st.btnText}>+ ADD BARBER</Text>
          </TouchableOpacity>
        </View>

        {/* Today's Summary */}
        <View style={st.section}>
          <Text style={st.sectionTitle}>Today's Summary</Text>
          {shopStats ? (
            <View style={st.statsCard}>
              <View style={st.statRow}>
                <Text style={st.statLabel}>Total</Text>
                <Text style={st.statValue}>{shopStats.total || 0}</Text>
              </View>
              <View style={st.statRow}>
                <Text style={st.statLabel}>Completed</Text>
                <Text style={[st.statValue, st.green]}>{shopStats.completed || 0}</Text>
              </View>
              <View style={st.statRow}>
                <Text style={st.statLabel}>Serving</Text>
                <Text style={st.statValue}>{shopStats.serving || 0}</Text>
              </View>
              <View style={st.statRow}>
                <Text style={st.statLabel}>Waiting</Text>
                <Text style={st.statValue}>{shopStats.waiting || 0}</Text>
              </View>
              <View style={st.statRow}>
                <Text style={st.statLabel}>Left/Skipped</Text>
                <Text style={[st.statValue, st.red]}>{(shopStats.left || 0) + (shopStats.skipped || 0)}</Text>
              </View>
            </View>
          ) : (
            <Text style={st.helper}>Loading...</Text>
          )}
        </View>

        {/* Daily Stats */}
        <View style={st.section}>
          <Text style={st.sectionTitle}>Daily Records</Text>
          {shopDailyStats.length > 0 ? (
            <View style={st.dailyList}>
              <View style={st.dailyHeader}>
                <Text style={st.dailyHeaderText}>Date</Text>
                <Text style={st.dailyHeaderText}>Total</Text>
                <Text style={st.dailyHeaderText}>Done</Text>
              </View>
              {shopDailyStats.map((day, i) => (
                <View key={i} style={st.dailyRow}>
                  <Text style={st.dailyDate}>{formatDate(day.date)}</Text>
                  <Text style={st.dailyTotal}>{day.total}</Text>
                  <Text style={st.dailyDone}>{day.completed}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={st.helper}>No data yet</Text>
          )}
        </View>

        {/* Delete Shop */}
        <View style={st.section}>
          <TouchableOpacity style={st.btnDeleteShop} onPress={() => setShowDeleteShopModal(true)}>
            <Text style={st.btnText}>DELETE THIS SHOP</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />

        {/* Modals */}
        <Modal visible={showResetSessionModal} transparent animationType="fade">
          <View style={st.overlay}>
            <View style={st.modalBox}>
              <Text style={st.modalTitle}>Reset Session?</Text>
              <Text style={st.modalMsg}>All barbers for this shop will be logged out.</Text>
              <View style={st.modalBtns}>
                <TouchableOpacity style={st.mCancel} onPress={() => setShowResetSessionModal(false)}>
                  <Text style={st.mCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[st.mConfirm, isBusy('reset-session') && st.btnDisabled]}
                  disabled={isBusy('reset-session')}
                  onPress={handleResetSession}
                >
                  {isBusy('reset-session') ? <ActivityIndicator color={colors.white} /> : <Text style={st.mConfirmText}>Reset</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <Modal visible={showRemoveTokenModal} transparent animationType="fade">
          <View style={st.overlay}>
            <View style={st.modalBox}>
              <Text style={st.modalTitle}>Remove Token?</Text>
              <Text style={st.modalMsg}>Remove #{tokenToRemove} from queue?</Text>
              <View style={st.modalBtns}>
                <TouchableOpacity style={st.mCancel} onPress={() => setShowRemoveTokenModal(false)}>
                  <Text style={st.mCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[st.mConfirm, isBusy('remove-token') && st.btnDisabled]}
                  disabled={isBusy('remove-token')}
                  onPress={handleRemoveToken}
                >
                  {isBusy('remove-token') ? <ActivityIndicator color={colors.white} /> : <Text style={st.mConfirmText}>Remove</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <Modal visible={showResetDayModal} transparent animationType="fade">
          <View style={st.overlay}>
            <View style={st.modalBox}>
              <Text style={st.modalTitle}>Reset Day?</Text>
              <Text style={st.modalMsg}>Clear ALL queue data for today for this shop?</Text>
              <View style={st.modalBtns}>
                <TouchableOpacity style={st.mCancel} onPress={() => setShowResetDayModal(false)}>
                  <Text style={st.mCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[st.mConfirmDanger, isBusy('reset-day') && st.btnDisabled]}
                  disabled={isBusy('reset-day')}
                  onPress={handleResetDay}
                >
                  {isBusy('reset-day') ? <ActivityIndicator color={colors.white} /> : <Text style={st.mConfirmText}>Reset</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <Modal visible={showDeleteShopModal} transparent animationType="fade">
          <View style={st.overlay}>
            <View style={st.modalBox}>
              <Text style={st.modalTitle}>Delete Shop?</Text>
              <Text style={st.modalMsg}>This will permanently delete "{selectedShop.name}" and all its data.</Text>
              <View style={st.modalBtns}>
                <TouchableOpacity style={st.mCancel} onPress={() => setShowDeleteShopModal(false)}>
                  <Text style={st.mCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[st.mConfirmDanger, isBusy('delete-shop') && st.btnDisabled]}
                  disabled={isBusy('delete-shop')}
                  onPress={handleDeleteShop}
                >
                  {isBusy('delete-shop') ? <ActivityIndicator color={colors.white} /> : <Text style={st.mConfirmText}>Delete</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Add Barber Modal */}
        <Modal visible={showAddBarberModal} transparent animationType="fade">
          {/* KeyboardAvoidingView lifts the modal box above the keyboard with a smooth native animation. */}
          <KeyboardAvoidingView behavior="padding" style={st.overlay}>
            <View style={st.modalBox}>
              <Text style={st.modalTitle}>Add Barber</Text>
              <Text style={st.formLabel}>Barber Name</Text>
              <TextInput
                style={st.input}
                value={newBarberName}
                onChangeText={setNewBarberName}
                placeholder="Enter barber name"
                placeholderTextColor={colors.textPlaceholder}
              />
              <View style={st.modalBtns}>
                <TouchableOpacity style={st.mCancel} onPress={() => { setShowAddBarberModal(false); setNewBarberName(''); }}>
                  <Text style={st.mCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[st.mConfirm, isBusy('add-barber') && st.btnDisabled]}
                  disabled={isBusy('add-barber')}
                  onPress={handleAddBarber}
                >
                  {isBusy('add-barber') ? <ActivityIndicator color={colors.white} /> : <Text style={st.mConfirmText}>Add</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </KeyboardAwareScrollView>
    );
  }

  // Main Shop List View
  return (
    <ScrollView style={st.container} contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>
      <View style={st.headerBar}>
        <View>
          <Text style={st.brand}>Quevix</Text>
          <Text style={st.brandSub}>Admin Panel</Text>
        </View>
        <TouchableOpacity style={st.logoutBtn} onPress={handleLogout}>
          <Text style={st.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      {toast ? <View style={st.toast}><Text style={st.toastText}>{toast}</Text></View> : null}

      {/* Create Shop Button */}
      <View style={st.section}>
        <TouchableOpacity style={st.btnPrimary} onPress={() => setShowCreateModal(true)}>
          <Text style={st.btnText}>+ CREATE NEW SHOP</Text>
        </TouchableOpacity>
      </View>

      {/* Shops List */}
      <View style={st.section}>
        <Text style={st.sectionTitle}>Your Shops ({shops.length})</Text>
        {shops.length > 0 ? (
          shops.map((shop) => (
            <TouchableOpacity 
              key={shop.id} 
              style={st.shopCard}
              onPress={() => setSelectedShop(shop)}
            >
              <View style={st.shopHeader}>
                <Text style={st.shopName}>{shop.name}</Text>
                <View style={[st.shopStatus, shop.isOpen ? st.statusOpen : st.statusClosed]}>
                  <Text style={st.shopStatusText}>{shop.isOpen ? 'OPEN' : 'CLOSED'}</Text>
                </View>
              </View>
              <Text style={st.shopId}>ID: {shop.shopId}</Text>
              <Text style={st.shopInfo}>Hours: {shop.openTime} - {shop.closeTime}</Text>
              <Text style={st.shopInfo}>Timer: {shop.waitingTimer} mins • {shop.activeBarbers} chair(s)</Text>
              <Text style={st.tapHint}>Tap to manage →</Text>
            </TouchableOpacity>
          ))
        ) : (
          <View style={st.emptyCard}>
            <Text style={st.emptyText}>No shops yet</Text>
            <Text style={st.emptyHint}>Create your first shop to get started</Text>
          </View>
        )}
      </View>

      <View style={{ height: 40 }} />

      {/* Create Shop Modal — KeyboardAvoidingView so the long form lifts above the keyboard. */}
      <Modal visible={showCreateModal} transparent animationType="fade">
        <KeyboardAvoidingView behavior="padding" style={st.overlay}>
          <View style={st.modalBoxLarge}>
            <Text style={st.modalTitle}>Create New Shop</Text>
            <ScrollView style={st.modalScroll}>
              <Text style={st.formLabel}>Shop ID (unique, no spaces)*</Text>
              <TextInput
                style={st.input}
                value={newShop.shopId}
                onChangeText={(t) => setNewShop({ ...newShop, shopId: t.toLowerCase().replace(/\s/g, '') })}
                placeholder="e.g. style, royal"
                placeholderTextColor={colors.textPlaceholder}
                autoCapitalize="none"
              />
              <Text style={st.formLabel}>Shop Name*</Text>
              <TextInput
                style={st.input}
                value={newShop.name}
                onChangeText={(t) => setNewShop({ ...newShop, name: t })}
                placeholder="e.g. Style Salon"
                placeholderTextColor={colors.textPlaceholder}
              />
              <Text style={st.formLabel}>Login Username*</Text>
              <TextInput
                style={st.input}
                value={newShop.username}
                onChangeText={(t) => setNewShop({ ...newShop, username: t })}
                placeholder="Barber login username"
                placeholderTextColor={colors.textPlaceholder}
                autoCapitalize="none"
              />
              <Text style={st.formLabel}>Login Password*</Text>
              <TextInput
                style={st.input}
                value={newShop.password}
                onChangeText={(t) => setNewShop({ ...newShop, password: t })}
                placeholder="Barber login password"
                placeholderTextColor={colors.textPlaceholder}
                secureTextEntry
              />
              <View style={st.row}>
                <View style={st.half}>
                  <Text style={st.formLabel}>Open Time</Text>
                  <TextInput
                    style={st.input}
                    value={newShop.openTime}
                    onChangeText={(t) => setNewShop({ ...newShop, openTime: t })}
                    placeholder="9:00 AM"
                    placeholderTextColor={colors.textPlaceholder}
                  />
                </View>
                <View style={st.half}>
                  <Text style={st.formLabel}>Close Time</Text>
                  <TextInput
                    style={st.input}
                    value={newShop.closeTime}
                    onChangeText={(t) => setNewShop({ ...newShop, closeTime: t })}
                    placeholder="10:00 PM"
                    placeholderTextColor={colors.textPlaceholder}
                  />
                </View>
              </View>
              <View style={st.row}>
                <View style={st.half}>
                  <Text style={st.formLabel}>Timer</Text>
                  <View style={st.timerControl}>
                    <TouchableOpacity 
                      style={[st.timerToggleBtn, newShop.waitingTimer === 0 ? st.timerOff : st.timerOn]}
                      onPress={() => {
                        if (newShop.waitingTimer === 0) {
                          setNewShop({ ...newShop, waitingTimer: 15 });
                        } else {
                          setNewShop({ ...newShop, waitingTimer: 0 });
                        }
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={st.timerToggleBtnText}>
                        {newShop.waitingTimer === 0 ? 'OFF' : `${newShop.waitingTimer} min`}
                      </Text>
                    </TouchableOpacity>
                    {newShop.waitingTimer !== 0 && (
                      <View style={st.timerAdjust}>
                        <TouchableOpacity 
                          style={st.timerAdjustBtn}
                          onPress={() => {
                            if (newShop.waitingTimer > 1) setNewShop({ ...newShop, waitingTimer: newShop.waitingTimer - 1 });
                          }}
                        >
                          <Text style={st.timerAdjustText}>−</Text>
                        </TouchableOpacity>
                        <TouchableOpacity 
                          style={st.timerAdjustBtn}
                          onPress={() => {
                            if (newShop.waitingTimer < 60) setNewShop({ ...newShop, waitingTimer: newShop.waitingTimer + 1 });
                          }}
                        >
                          <Text style={st.timerAdjustText}>+</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </View>
                <View style={st.half}>
                  <Text style={st.formLabel}>Chairs (1-10)</Text>
                  <View style={st.chairSelector}>
                    <TouchableOpacity 
                      style={st.chairBtn}
                      onPress={() => {
                        if (newShop.activeBarbers > 1) setNewShop({ ...newShop, activeBarbers: newShop.activeBarbers - 1 });
                      }}
                    >
                      <Text style={st.chairBtnText}>−</Text>
                    </TouchableOpacity>
                    <Text style={st.chairCount}>{newShop.activeBarbers}</Text>
                    <TouchableOpacity 
                      style={st.chairBtn}
                      onPress={() => {
                        if (newShop.activeBarbers < 10) setNewShop({ ...newShop, activeBarbers: newShop.activeBarbers + 1 });
                      }}
                    >
                      <Text style={st.chairBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </ScrollView>
            <View style={st.modalBtns}>
              <TouchableOpacity style={st.mCancel} onPress={() => setShowCreateModal(false)}>
                <Text style={st.mCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[st.mConfirm, isBusy('create-shop') && st.btnDisabled]}
                disabled={isBusy('create-shop')}
                onPress={handleCreateShop}
              >
                {isBusy('create-shop') ? <ActivityIndicator color={colors.white} /> : <Text style={st.mConfirmText}>Create</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  scrollPad: { padding: 16, paddingTop: 56 },
  headerSection: { marginBottom: 24 },
  headerBar: { padding: 16, paddingTop: 56, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brand: { fontFamily: fontFamilies.display, fontSize: typography.size.h1 + 2, fontWeight: typography.weight.extrabold, color: colors.textPrimary, letterSpacing: typography.tracking.wider },
  brandSub: { fontFamily: fontFamilies.display, fontSize: typography.size.sm, color: colors.textSecondary, marginTop: 2, letterSpacing: typography.tracking.wide },
  subtitle: { fontSize: 15, color: colors.textPrimary, marginTop: 8 },
  backBtn: { fontSize: 16, color: colors.brandPrimary, fontWeight: '600' },
  shopTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  logoutBtn: { backgroundColor: colors.surfaceAlt, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  logoutText: { fontSize: 14, color: colors.danger, fontWeight: '600' },

  card: { backgroundColor: colors.white, borderRadius: 12, padding: 20, borderWidth: 1, borderColor: colors.border },
  cardLabel: { fontSize: 15, fontWeight: '600', color: colors.textPrimary, marginBottom: 8, marginTop: 12 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 14, fontSize: 16, marginBottom: 8, backgroundColor: colors.white },
  errorText: { color: colors.danger, fontSize: 13, marginBottom: 8 },

  section: { marginHorizontal: 16, marginTop: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginBottom: 12 },
  
  btnPrimary: { backgroundColor: colors.brandPrimary, padding: 16, borderRadius: 10, alignItems: 'center' },
  btnText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  btnDisabled: { opacity: 0.5 },
  btnSuccess: { backgroundColor: colors.success, padding: 16, borderRadius: 10, alignItems: 'center', marginTop: 12 },
  btnDanger: { backgroundColor: colors.danger, padding: 16, borderRadius: 10, alignItems: 'center', marginTop: 12 },
  btnWarning: { backgroundColor: colors.warning, padding: 16, borderRadius: 10, alignItems: 'center' },
  btnOutline: { backgroundColor: colors.white, padding: 14, borderRadius: 10, alignItems: 'center', borderWidth: 2, borderColor: colors.brandPrimary },
  btnOutlineText: { color: colors.brandPrimary, fontSize: 15, fontWeight: '700' },
  btnToggle: { padding: 16, borderRadius: 10, alignItems: 'center', marginTop: 16 },
  btnRemove: { backgroundColor: colors.warning, paddingHorizontal: 20, paddingVertical: 14, borderRadius: 8, marginLeft: 10 },
  btnDeleteShop: { backgroundColor: colors.textSecondary, padding: 16, borderRadius: 10, alignItems: 'center' },

  toast: { backgroundColor: colors.success, padding: 14, marginHorizontal: 16, marginTop: 8, borderRadius: 10, alignItems: 'center' },
  toastText: { color: colors.white, fontSize: 14, fontWeight: '600' },
  helper: { fontSize: 12, color: colors.textSecondary, marginTop: 6, fontStyle: 'italic' },

  statusCard: { backgroundColor: colors.white, margin: 16, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.surfaceAlt },
  statusLabel: { fontSize: 15, color: colors.textSecondary },
  statusValue: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  green: { color: colors.success },
  red: { color: colors.danger },
  qrUrl: { color: colors.brandPrimary },

  shopCard: { backgroundColor: colors.white, borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
  shopHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  shopName: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  shopStatus: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  statusOpen: { backgroundColor: colors.successBg },
  statusClosed: { backgroundColor: colors.dangerBg },
  shopStatusText: { fontSize: 12, fontWeight: '700' },
  shopId: { fontSize: 13, color: colors.brandPrimary, marginBottom: 4 },
  shopInfo: { fontSize: 13, color: colors.textSecondary, marginBottom: 2 },
  tapHint: { fontSize: 12, color: colors.info, marginTop: 8, fontWeight: '600' },

  emptyCard: { backgroundColor: colors.white, borderRadius: 12, padding: 32, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  emptyText: { fontSize: 18, color: colors.textSecondary, fontWeight: '600' },
  emptyHint: { fontSize: 14, color: colors.textMuted, marginTop: 8 },

  editForm: { backgroundColor: colors.white, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: colors.border },
  formLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginBottom: 4, marginTop: 12 },
  row: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
  editBtns: { flexDirection: 'row', gap: 12, marginTop: 16 },
  btnCancel: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center', backgroundColor: colors.surfaceAlt },
  btnCancelText: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  btnSave: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center', backgroundColor: colors.success },

  tokenRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, marginBottom: 12 },

  statsCard: { backgroundColor: colors.white, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: colors.border },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.surfaceAlt },
  statLabel: { fontSize: 15, color: colors.textSecondary },
  statValue: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },

  dailyList: { backgroundColor: colors.white, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.border },
  dailyHeader: { flexDirection: 'row', paddingBottom: 8, borderBottomWidth: 2, borderBottomColor: colors.border },
  dailyHeaderText: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.textSecondary, textAlign: 'center' },
  dailyRow: { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.surfaceAlt },
  dailyDate: { flex: 1, fontSize: 14, color: colors.textPrimary, textAlign: 'center' },
  dailyTotal: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  dailyDone: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.success, textAlign: 'center' },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalBox: { backgroundColor: colors.white, borderRadius: 16, padding: 24, width: '85%', maxWidth: 360 },
  modalBoxLarge: { backgroundColor: colors.white, borderRadius: 16, padding: 24, width: '90%', maxWidth: 400, maxHeight: '80%' },
  modalScroll: { maxHeight: 400, marginBottom: 16 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, marginBottom: 8, textAlign: 'center' },
  modalMsg: { fontSize: 15, color: colors.textSecondary, marginBottom: 20, textAlign: 'center' },
  modalBtns: { flexDirection: 'row', gap: 12 },
  mCancel: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center', backgroundColor: colors.surfaceAlt },
  mConfirm: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center', backgroundColor: colors.success },
  mConfirmDanger: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center', backgroundColor: colors.danger },
  mCancelText: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  mConfirmText: { color: colors.white, fontSize: 15, fontWeight: '600' },

  // Barber management styles
  barbersList: { backgroundColor: colors.white, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 12 },
  barberItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.surfaceAlt },
  barberInfo: { flex: 1 },
  barberName: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  barberChair: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  barberDeleteBtn: { backgroundColor: colors.dangerBg, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  barberDeleteText: { fontSize: 12, color: colors.danger, fontWeight: '600' },
  emptyBarbers: { fontSize: 14, color: colors.textMuted, fontStyle: 'italic', marginBottom: 12 },
  btnAddBarber: { backgroundColor: colors.info, padding: 14, borderRadius: 10, alignItems: 'center' },

  // Chair selector styles
  chairSelector: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: 8 },
  chairBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandPrimary, justifyContent: 'center', alignItems: 'center' },
  chairBtnText: { color: colors.white, fontSize: 20, fontWeight: '700' },
  chairCount: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginHorizontal: 16, minWidth: 24, textAlign: 'center' },

  // Timer toggle styles
  timerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  timerInput: { flex: 1 },
  inputDisabled: { backgroundColor: colors.border, color: colors.textSecondary },
  timerToggle: { backgroundColor: colors.danger, paddingHorizontal: 10, paddingVertical: 12, borderRadius: 8 },
  timerToggleOff: { backgroundColor: colors.success },
  timerToggleText: { color: colors.white, fontSize: 12, fontWeight: '700' },

  // New timer control styles
  timerControl: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  timerToggleBtn: { flex: 1, paddingVertical: 14, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  timerOn: { backgroundColor: colors.success },
  timerOff: { backgroundColor: colors.danger },
  timerToggleBtnText: { color: colors.white, fontSize: 14, fontWeight: '700' },
  timerAdjust: { flexDirection: 'row', gap: 4 },
  timerAdjustBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: colors.brandPrimary, justifyContent: 'center', alignItems: 'center' },
  timerAdjustText: { color: colors.white, fontSize: 18, fontWeight: '700' },
});
