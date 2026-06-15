import { Feather } from '@expo/vector-icons';
import React, { useState, useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerMobilePushDevice } from '../lib/mobileNotifications';
import { getBackendBaseUrl } from '../lib/backendUrl';
import { fetchWithRetry } from '../lib/fetchWithRetry';
import {
  Avatar,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  IconCircle,
  Pill,
  PressableScale,
  Screen,
  ScreenHeader,
  Section,
  TextField,
} from '../src/components/ui';
import { palette, radius, space, type } from '../src/theme/tokens';
import { useNow } from '../src/utils/time';

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
  // Live ticker so the serving countdown stays current between 15s polls.
  const now = useNow(1000);

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
      const nowDate = new Date();
      const cutoff = new Date(nowDate.getTime() - COOLDOWN_MIN * 60 * 1000);
      history = history.filter((ts: string) => new Date(ts) > cutoff);
      if (history.length >= MAX_JOINS) {
        const oldest = new Date(history[0]);
        const remaining = Math.ceil(COOLDOWN_MIN - (nowDate.getTime() - oldest.getTime()) / 60000);
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

  // =========================================================================
  // STEP 3: Live ticket (after joined)
  // =========================================================================
  if (joined && queueStatus) {
    const isServing = queueStatus.status === 'serving';
    const isWaiting = !isServing;

    // Remaining arrival timer for serving customers (expiresAt is UTC; tick via `now`).
    let timerMinutes = 0;
    let timerLabel: string | null = null;
    if (isServing && queueStatus.expiresAt && !queueStatus.serviceStartedAt) {
      const expiresAtStr = queueStatus.expiresAt.endsWith('Z') ? queueStatus.expiresAt : queueStatus.expiresAt + 'Z';
      const diffMs = new Date(expiresAtStr).getTime() - now;
      timerMinutes = Math.max(0, Math.ceil(diffMs / 60000));
      timerLabel = timerMinutes > 0 ? `${timerMinutes} min to arrive` : 'Arrival time elapsed';
    }

    const otherEntries = myEntries.filter((e) => e.id !== queueStatus.id);

    return (
      <Screen>
        <View style={styles.ticketHead}>
          <Text style={[type.label, { color: palette.accentInk }]}>{selectedShop?.name || 'Queue'}</Text>
          <Text style={[type.title, { marginTop: 4 }]}>Your ticket</Text>
        </View>

        {/* The ticket */}
        <Card level="lg" padding={0} style={[styles.ticket, isServing && styles.ticketServing]}>
          <View style={styles.ticketTop}>
            <Pill label={isServing ? "It's your turn" : 'Waiting'} tone={isServing ? 'teal' : 'amber'} dot />
            <Text style={styles.ticketLabel}>Token</Text>
            <Text style={[type.display, styles.ticketNumber, isServing && { color: palette.liveTeal }]}>#{queueStatus.tokenNumber}</Text>
            <Text style={styles.ticketName}>{queueStatus.name}</Text>
          </View>

          {/* Perforation */}
          <View style={styles.perforation}>
            <View style={[styles.notch, styles.notchLeft]} />
            <View style={styles.dashed} />
            <View style={[styles.notch, styles.notchRight]} />
          </View>

          <View style={styles.ticketBottom}>
            {isWaiting ? (
              <View style={styles.ticketStat}>
                <View style={styles.aheadBlock}>
                  <Text style={styles.aheadNumber}>{queueStatus.peopleAhead}</Text>
                  <Text style={styles.aheadLabel}>{queueStatus.peopleAhead === 1 ? 'person ahead' : 'people ahead'}</Text>
                </View>
                <View style={styles.divider} />
                <View style={styles.servingBlock}>
                  <Text style={[type.label, { marginBottom: 6 }]}>Now serving</Text>
                  <Text style={styles.servingText}>
                    {queueStatus.servingNow?.length ? queueStatus.servingNow.map((n) => `#${n}`).join('  ') : 'No one yet'}
                  </Text>
                </View>
              </View>
            ) : (
              <View style={styles.servingNow}>
                <View style={styles.servingNowRow}>
                  <IconCircle name="navigation" size={40} bg={palette.liveTealSoft} color={palette.liveTeal} />
                  <View style={{ flex: 1 }}>
                    <Text style={[type.heading, { color: palette.ink }]}>Head to the shop now</Text>
                    <Text style={type.small}>Your chair is ready.</Text>
                  </View>
                </View>
                {queueStatus.serviceStartedAt ? (
                  <View style={[styles.timerChip, { backgroundColor: palette.liveTealSoft }]}>
                    <Feather name="check" size={15} color={palette.liveTeal} />
                    <Text style={[styles.timerText, { color: palette.liveTeal }]}>Service in progress</Text>
                  </View>
                ) : timerLabel !== null ? (
                  <View style={[styles.timerChip, timerMinutes === 0 ? { backgroundColor: palette.dangerRoseSoft } : { backgroundColor: palette.warnAmberSoft }]}>
                    <Feather name="clock" size={15} color={timerMinutes === 0 ? palette.dangerRose : palette.warnAmber} />
                    <Text style={[styles.timerText, { color: timerMinutes === 0 ? palette.dangerRose : palette.warnAmber }]}>
                      {timerLabel}
                    </Text>
                  </View>
                ) : null}
              </View>
            )}
          </View>
        </Card>

        <View style={{ gap: space.md, marginTop: space['2xl'] }}>
          {myEntries.length < MAX_JOINS && (
            <Button label="Join another shop" variant="secondary" icon="plus" fullWidth onPress={handleNewEntry} />
          )}
          <Button label="Leave queue" variant="danger" icon="log-out" fullWidth onPress={() => setShowLeaveModal(true)} />
        </View>

        {otherEntries.length > 0 && (
          <Section title="Your other tickets">
            <View style={{ gap: space.md }}>
              {otherEntries.map((entry) => (
                <PressableScale key={entry.id} onPress={() => viewEntry(entry)}>
                  <Card level="sm" padding="lg" style={styles.ticketRow}>
                    <View style={styles.tokenChip}>
                      <Text style={styles.tokenChipText}>#{entry.tokenNumber}</Text>
                    </View>
                    <Text style={[type.body, { flex: 1 }]}>{entry.shopName}</Text>
                    <Feather name="chevron-right" size={20} color={palette.inkFaint} />
                  </Card>
                </PressableScale>
              ))}
            </View>
          </Section>
        )}

        <BottomSheet visible={showLeaveModal} onClose={() => setShowLeaveModal(false)} title="Leave the queue?">
          <Text style={[type.body, { color: palette.inkMuted, marginBottom: space['2xl'] }]}>
            You'll lose your spot in line and need a new token to rejoin.
          </Text>
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <Button label="Stay" variant="secondary" fullWidth onPress={() => setShowLeaveModal(false)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Leave" variant="danger" fullWidth loading={leaving} onPress={confirmLeaveQueue} />
            </View>
          </View>
        </BottomSheet>
      </Screen>
    );
  }

  // =========================================================================
  // STEP 2: Join form (after shop selected)
  // =========================================================================
  if (selectedShop) {
    const activeBarbers = barbers.filter((b) => b.isActive);
    const chosen = activeBarbers.find((b) => b.id === selectedBarber);
    return (
      <>
        <Screen>
          <PressableScale onPress={handleBackToShops} style={styles.backChip}>
            <Feather name="chevron-left" size={18} color={palette.accentInk} />
            <Text style={styles.backText}>All shops</Text>
          </PressableScale>

          <Card tint={palette.accentSoft} level="flat" style={styles.shopBanner}>
            <View style={{ flex: 1 }}>
              <Text style={[type.label, { color: palette.accentInk }]}>Selected shop</Text>
              <Text style={[type.title, { marginTop: 6 }]}>{selectedShop.name}</Text>
              {!!(selectedShop.openTime || selectedShop.closeTime) && (
                <View style={styles.metaRow}>
                  <Feather name="clock" size={14} color={palette.inkMuted} />
                  <Text style={styles.metaText}>
                    {selectedShop.openTime} – {selectedShop.closeTime}
                  </Text>
                </View>
              )}
            </View>
            <Pill label="Open" tone="teal" dot />
          </Card>

          <Section title="Join the queue" style={{ marginTop: space['2xl'] }}>
            <Card>
              <TextField
                label="Your name"
                value={name}
                onChangeText={(t) => { setName(t); setErrorMessage(''); }}
                placeholder="e.g. Alex"
                maxLength={50}
                autoCapitalize="words"
              />

              {activeBarbers.length > 0 && (
                <View style={{ marginTop: space.xl }}>
                  <Text style={[type.label, { marginBottom: 8 }]}>Prefer a barber? · Optional</Text>
                  <PressableScale onPress={() => setShowBarberPicker(true)} style={styles.select}>
                    {chosen ? (
                      <>
                        <Avatar name={chosen.name} size={32} />
                        <Text style={styles.selectText}>{chosen.name} · Chair {chosen.chairNumber}</Text>
                      </>
                    ) : (
                      <>
                        <IconCircle name="users" size={32} />
                        <Text style={styles.selectText}>Any available barber</Text>
                      </>
                    )}
                    <Feather name="chevron-down" size={18} color={palette.inkFaint} />
                  </PressableScale>
                </View>
              )}

              {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

              <Button
                label="Join queue"
                icon="arrow-right"
                size="lg"
                fullWidth
                loading={loading}
                onPress={handleJoinQueue}
                style={{ marginTop: space['2xl'] }}
              />
              <View style={styles.reassure}>
                <Feather name="shield" size={13} color={palette.inkFaint} />
                <Text style={styles.reassureText}>We hold your place — track your turn from your phone.</Text>
              </View>
            </Card>
          </Section>
        </Screen>

        <BottomSheet
          visible={showBarberPicker}
          onClose={() => setShowBarberPicker(false)}
          title="Choose a barber"
          subtitle="Pick a preferred barber or let any available barber take you."
          scroll
        >
          <PickerRow
            label="Any available barber"
            leading={<IconCircle name="users" size={40} />}
            selected={!selectedBarber}
            onPress={() => { setSelectedBarber(null); setShowBarberPicker(false); }}
          />
          {activeBarbers.map((b) => (
            <PickerRow
              key={b.id}
              label={b.name}
              sub={`Chair ${b.chairNumber}`}
              leading={<Avatar name={b.name} size={40} />}
              selected={selectedBarber === b.id}
              onPress={() => { setSelectedBarber(b.id); setShowBarberPicker(false); }}
            />
          ))}
        </BottomSheet>
      </>
    );
  }

  // =========================================================================
  // STEP 1: Shop select
  // =========================================================================
  return (
    <Screen>
      <ScreenHeader
        eyebrow="Quevix · Front desk"
        title="Find your chair"
        subtitle="Join a barbershop queue and track your turn in real time."
      />

      {/* Line-art hero band — the "friendly utility" welcome */}
      <Card tint={palette.accentSoft} borderColor={palette.accentSoftLine} level="flat" style={styles.hero}>
        <View style={styles.heroGlyph}>
          <Feather name="scissors" size={26} color={palette.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[type.heading, { color: palette.accentInk }]}>Walk in, we'll hold your chair</Text>
          <Text style={[type.small, { marginTop: 4, color: palette.inkMuted }]}>
            No more waiting at the door — grab a token and wander.
          </Text>
        </View>
      </Card>
      <View style={styles.heroDash} />

      {errorMessage ? (
        <Card tint={palette.dangerRoseSoft} borderColor={palette.dangerRoseLine} level="flat" padding="lg" style={{ marginTop: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Feather name="alert-circle" size={18} color={palette.dangerRose} />
          <Text style={[type.small, { color: palette.dangerRose, flex: 1 }]}>{errorMessage}</Text>
        </Card>
      ) : null}

      {myEntries.length > 0 && (
        <Section title="Your tickets">
          <View style={{ gap: space.md }}>
            {myEntries.map((entry) => (
              <PressableScale key={entry.id} onPress={() => viewEntry(entry)}>
                <Card level="sm" padding="lg" style={styles.ticketRow}>
                  <View style={styles.tokenChip}>
                    <Text style={styles.tokenChipText}>#{entry.tokenNumber}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={type.body}>{entry.name}</Text>
                    <Text style={type.small}>{entry.shopName}</Text>
                  </View>
                  <Feather name="chevron-right" size={20} color={palette.inkFaint} />
                </Card>
              </PressableScale>
            ))}
          </View>
        </Section>
      )}

      <Section title="Choose a shop">
        {shops.length > 0 ? (
          <View style={{ gap: space.md }}>
            {shops.map((shop) => (
              <PressableScale key={shop.shopId} onPress={() => handleSelectShop(shop)} disabled={!shop.isOpen}>
                <Card level="sm" style={[styles.shopCard, shop.isOpen && styles.shopCardOpen, !shop.isOpen && { opacity: 0.75 }]}>
                  <View style={styles.shopTop}>
                    <IconCircle
                      name="scissors"
                      size={48}
                      bg={shop.isOpen ? palette.accentSoft : palette.surfaceMuted}
                      color={shop.isOpen ? palette.accent : palette.inkFaint}
                    />
                    <View style={styles.shopInfo}>
                      <Text style={type.heading}>{shop.name}</Text>
                      <View style={styles.metaRow}>
                        <Feather name="clock" size={13} color={palette.inkFaint} />
                        <Text style={styles.metaText}>{shop.openTime} – {shop.closeTime}</Text>
                      </View>
                    </View>
                    <Pill label={shop.isOpen ? 'Open' : 'Closed'} tone={shop.isOpen ? 'teal' : 'neutral'} dot={shop.isOpen} />
                  </View>
                  <View style={styles.shopFoot}>
                    {shop.isOpen ? (
                      <>
                        <Feather name="arrow-right-circle" size={14} color={palette.inkMuted} />
                        <Text style={styles.shopFootText}>Tap to join the queue</Text>
                        <Feather name="chevron-right" size={18} color={palette.accent} style={{ marginLeft: 'auto' }} />
                      </>
                    ) : (
                      <>
                        <Feather name="moon" size={14} color={palette.inkFaint} />
                        <Text style={[styles.shopFootText, { color: palette.inkFaint }]}>Not accepting customers right now</Text>
                      </>
                    )}
                  </View>
                </Card>
              </PressableScale>
            ))}
          </View>
        ) : loadingShops ? (
          <Card level="sm" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.md }}>
            <ActivityIndicator color={palette.accent} />
            <Text style={type.bodyMuted}>Loading shops…</Text>
          </Card>
        ) : (
          <EmptyState icon="home" title="No shops available" hint="Check back soon — shops appear here when they open." />
        )}
      </Section>
    </Screen>
  );
}

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
  backChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingRight: space.md,
    marginBottom: space.md,
  },
  backText: { color: palette.accentInk, fontSize: 15, fontWeight: '700', marginLeft: 2 },

  shopBanner: { flexDirection: 'row', alignItems: 'flex-start' },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 6 },
  metaText: { color: palette.inkMuted, fontSize: 13.5, fontWeight: '500' },

  errorText: { color: palette.dangerRose, fontSize: 13, fontWeight: '600', marginTop: 8 },

  select: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: palette.surfaceMuted,
    borderWidth: 1.5,
    borderColor: palette.line,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  selectText: { flex: 1, color: palette.ink, fontSize: 15.5, fontWeight: '600' },

  reassure: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: space.lg },
  reassureText: { color: palette.inkFaint, fontSize: 12.5, fontWeight: '500' },

  // hero band
  hero: { flexDirection: 'row', alignItems: 'center', gap: space.lg, marginTop: space.xs },
  heroGlyph: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: palette.accentSoftLine,
    backgroundColor: palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroDash: {
    marginTop: space.lg,
    borderBottomWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: palette.accentSoftLine,
  },

  // shop list
  shopCard: { gap: space.lg },
  shopCardOpen: { borderLeftWidth: 4, borderLeftColor: palette.accent },
  shopTop: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  shopInfo: { flex: 1 },
  shopFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: palette.line,
    paddingTop: space.lg,
  },
  shopFootText: { color: palette.inkMuted, fontSize: 13.5, fontWeight: '600' },

  // ticket rows (lists)
  ticketRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  tokenChip: {
    minWidth: 56,
    height: 44,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: palette.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tokenChipText: { color: palette.accentInk, fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },

  // ticket hero
  ticketHead: { marginBottom: space.xl },
  ticket: { overflow: 'visible' },
  ticketServing: { backgroundColor: palette.liveTealSoft },
  ticketTop: { alignItems: 'center', paddingTop: space['3xl'], paddingBottom: space['2xl'], paddingHorizontal: space['2xl'] },
  ticketLabel: { ...type.label, marginTop: space.lg },
  ticketNumber: { fontSize: 76, lineHeight: 80, color: palette.accent, marginTop: 4 },
  ticketName: { ...type.heading, marginTop: space.xs },

  perforation: { height: 24, justifyContent: 'center' },
  dashed: {
    marginHorizontal: space['2xl'],
    borderBottomWidth: 2,
    borderStyle: 'dashed',
    borderColor: palette.lineStrong,
  },
  notch: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: palette.canvas,
    top: 0,
  },
  notchLeft: { left: -12 },
  notchRight: { right: -12 },

  ticketBottom: { paddingHorizontal: space['2xl'], paddingTop: space['2xl'], paddingBottom: space['3xl'] },
  ticketStat: { flexDirection: 'row', alignItems: 'center' },
  aheadBlock: { alignItems: 'center', paddingRight: space.xl },
  aheadNumber: { fontSize: 44, fontWeight: '800', color: palette.ink, fontVariant: ['tabular-nums'], letterSpacing: -1 },
  aheadLabel: { ...type.small, marginTop: 2 },
  divider: { width: 1, alignSelf: 'stretch', backgroundColor: palette.line },
  servingBlock: { flex: 1, paddingLeft: space.xl },
  servingText: { fontSize: 20, fontWeight: '800', color: palette.accentInk, fontVariant: ['tabular-nums'] },

  servingNow: { gap: space.lg },
  servingNowRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  timerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  timerText: { fontSize: 15, fontWeight: '800' },

  // picker
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
