import React, { useState, useEffect } from 'react';
import { Platform } from 'react-native';

// This component only renders on web
const EXPO_PUBLIC_BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

interface QueueStatus {
  id: string;
  tokenNumber: number;
  name: string;
  status: string;
  servingNow: number[];
  peopleAhead: number;
  currentlyServing: number;
}

interface ShopSettings {
  effectivelyOpen: boolean;
  waitingCount?: number;
  servingNow?: number[];
}

export default function WebCustomerView() {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [joined, setJoined] = useState(false);
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [shopOpen, setShopOpen] = useState(true);
  const [waitingCount, setWaitingCount] = useState(0);
  const [servingNow, setServingNow] = useState<number[]>([]);
  const [error, setError] = useState('');

  // Check for saved entry on mount
  useEffect(() => {
    const init = async () => {
      try {
        // Load saved entry
        const saved = localStorage.getItem('webQueueEntry');
        if (saved) {
          const entry = JSON.parse(saved);
          await checkStatus(entry.id);
        }
        // Load shop status
        await loadShopStatus();
      } catch (e) {
        console.error('Init error:', e);
      } finally {
        setInitialLoading(false);
      }
    };
    init();

    // Poll for updates
    const interval = setInterval(() => {
      if (joined && queueStatus) {
        checkStatus(queueStatus.id);
      } else {
        loadShopStatus();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [joined, queueStatus?.id]);

  const loadShopStatus = async () => {
    try {
      const [settingsRes, queueRes] = await Promise.all([
        fetch(`${EXPO_PUBLIC_BACKEND_URL}/api/settings`),
        fetch(`${EXPO_PUBLIC_BACKEND_URL}/api/queue/current`)
      ]);
      
      if (settingsRes.ok) {
        const settings = await settingsRes.json();
        setShopOpen(settings.effectivelyOpen);
      }
      
      if (queueRes.ok) {
        const queue = await queueRes.json();
        setWaitingCount(queue.waitingCount || 0);
        setServingNow(queue.servingNow || []);
      }
    } catch (e) {
      console.error('Load shop status error:', e);
    }
  };

  const checkStatus = async (entryId: string) => {
    try {
      const res = await fetch(`${EXPO_PUBLIC_BACKEND_URL}/api/queue/status/${entryId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'waiting' || data.status === 'serving') {
          setQueueStatus(data);
          setJoined(true);
          localStorage.setItem('webQueueEntry', JSON.stringify(data));
        } else {
          // Completed or left
          setQueueStatus(data);
          setJoined(true);
        }
      } else if (res.status === 404) {
        localStorage.removeItem('webQueueEntry');
        setJoined(false);
        setQueueStatus(null);
      }
    } catch (e) {
      console.error('Check status error:', e);
    }
  };

  const handleJoin = async () => {
    if (!name.trim()) {
      setError('Please enter your name');
      return;
    }
    
    setError('');
    setLoading(true);
    
    try {
      const res = await fetch(`${EXPO_PUBLIC_BACKEND_URL}/api/queue/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), addedBy: 'customer' })
      });
      
      if (res.ok) {
        const data = await res.json();
        setQueueStatus(data);
        setJoined(true);
        localStorage.setItem('webQueueEntry', JSON.stringify(data));
      } else if (res.status === 403) {
        setError('Shop is currently closed');
      } else {
        const errData = await res.json().catch(() => ({}));
        setError(errData.detail || 'Failed to join queue');
      }
    } catch (e) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleLeave = async () => {
    if (!queueStatus || !window.confirm('Are you sure you want to leave the queue?')) return;
    
    try {
      const res = await fetch(`${EXPO_PUBLIC_BACKEND_URL}/api/queue/${queueStatus.id}/leave`, {
        method: 'PATCH'
      });
      
      if (res.ok) {
        setQueueStatus({ ...queueStatus, status: 'left' });
      }
    } catch (e) {
      console.error('Leave error:', e);
    }
  };

  const handleRejoin = () => {
    localStorage.removeItem('webQueueEntry');
    setJoined(false);
    setQueueStatus(null);
    setName('');
  };

  // Only render on web
  if (Platform.OS !== 'web') {
    return null;
  }

  if (initialLoading) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.loading}>
            <div style={styles.spinner}></div>
            <p>Loading...</p>
          </div>
        </div>
        <style>{spinnerCSS}</style>
      </div>
    );
  }

  // Queue status view
  if (joined && queueStatus) {
    const isServing = queueStatus.status === 'serving';
    const isCompleted = queueStatus.status === 'completed';
    const isLeft = queueStatus.status === 'left';
    const showRejoin = isCompleted || isLeft;

    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.header}>
            <h1 style={styles.logo}>Quevix</h1>
            <p style={styles.tagline}>Smart Queue Management</p>
          </div>

          <div style={styles.content}>
            {isServing && (
              <div style={styles.yourTurn}>
                <span style={styles.yourTurnIcon}>🎉</span>
                <h2 style={styles.yourTurnTitle}>It's Your Turn!</h2>
                <p style={styles.yourTurnSub}>Please proceed to the barber</p>
              </div>
            )}

            {isCompleted && (
              <div style={styles.completed}>
                <span style={styles.completedIcon}>✅</span>
                <h2 style={styles.completedTitle}>Service Completed</h2>
                <p style={styles.completedSub}>Thank you for visiting!</p>
              </div>
            )}

            {isLeft && (
              <div style={styles.completed}>
                <span style={styles.completedIcon}>👋</span>
                <h2 style={styles.completedTitle}>You Left the Queue</h2>
                <p style={styles.completedSub}>See you next time!</p>
              </div>
            )}

            {!showRejoin && (
              <>
                <div style={styles.tokenDisplay}>
                  <p style={styles.tokenLabel}>Your Token Number</p>
                  <h1 style={styles.tokenNumber}>{queueStatus.tokenNumber}</h1>
                  <p style={styles.tokenName}>{queueStatus.name}</p>
                </div>

                {!isServing && (
                  <div style={styles.statusGrid}>
                    <div style={styles.statusCard}>
                      <h2 style={styles.statusValue}>{queueStatus.peopleAhead}</h2>
                      <p style={styles.statusLabel}>People Ahead</p>
                    </div>
                    <div style={styles.statusCardGreen}>
                      <h2 style={styles.statusValueGreen}>{queueStatus.currentlyServing}</h2>
                      <p style={styles.statusLabel}>Being Served</p>
                    </div>
                  </div>
                )}

                <div style={styles.servingNow}>
                  <p style={styles.servingNowTitle}>NOW SERVING</p>
                  <div style={styles.servingTokens}>
                    {queueStatus.servingNow && queueStatus.servingNow.length > 0 ? (
                      queueStatus.servingNow.map(t => (
                        <span key={t} style={styles.servingToken}>#{t}</span>
                      ))
                    ) : (
                      <span style={styles.noServing}>No one being served</span>
                    )}
                  </div>
                </div>

                <button style={styles.leaveBtn} onClick={handleLeave}>
                  Leave Queue
                </button>
              </>
            )}

            {showRejoin && (
              <button style={styles.joinBtn} onClick={handleRejoin}>
                Join Queue Again
              </button>
            )}

            {!showRejoin && (
              <p style={styles.updateNote}>
                <span style={styles.updateDot}></span>
                Auto-updating every 5 seconds
              </p>
            )}
          </div>
        </div>
        <style>{spinnerCSS}</style>
      </div>
    );
  }

  // Join form view
  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.header}>
          <h1 style={styles.logo}>Quevix</h1>
          <p style={styles.tagline}>Smart Queue Management</p>
        </div>

        <div style={styles.content}>
          <div style={shopOpen ? styles.shopOpen : styles.shopClosed}>
            <span style={styles.statusDot}></span>
            <span>{shopOpen ? 'Shop is Open' : 'Shop is Closed'}</span>
          </div>

          <div style={styles.queueInfo}>
            <div style={styles.infoCard}>
              <p style={styles.infoLabel}>WAITING</p>
              <h2 style={styles.infoValue}>{waitingCount}</h2>
            </div>
            <div style={styles.infoCard}>
              <p style={styles.infoLabel}>NOW SERVING</p>
              <h2 style={styles.infoValueGreen}>
                {servingNow.length > 0 ? `#${servingNow.join(', #')}` : '-'}
              </h2>
            </div>
          </div>

          {error && <div style={styles.error}>{error}</div>}

          <div style={styles.formGroup}>
            <label style={styles.formLabel}>Your Name</label>
            <input
              type="text"
              style={styles.formInput}
              value={name}
              onChange={(e) => { setName(e.target.value); setError(''); }}
              placeholder="Enter your name"
              disabled={!shopOpen}
            />
          </div>

          <button
            style={loading || !shopOpen ? styles.joinBtnDisabled : styles.joinBtn}
            onClick={handleJoin}
            disabled={loading || !shopOpen}
          >
            {loading ? 'Joining...' : shopOpen ? 'Join Queue' : 'Shop Closed'}
          </button>
        </div>
      </div>
      <style>{spinnerCSS}</style>
    </div>
  );
}

const spinnerCSS = `
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
`;

const styles: { [key: string]: React.CSSProperties } = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  card: {
    width: '100%',
    maxWidth: '420px',
    background: 'white',
    borderRadius: '24px',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    overflow: 'hidden',
  },
  header: {
    background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
    padding: '32px 24px',
    textAlign: 'center' as const,
    color: 'white',
  },
  logo: {
    fontSize: '32px',
    fontWeight: 700,
    margin: '0 0 8px 0',
    letterSpacing: '-1px',
  },
  tagline: {
    fontSize: '14px',
    margin: 0,
    opacity: 0.9,
  },
  content: {
    padding: '32px 24px',
  },
  loading: {
    textAlign: 'center' as const,
    padding: '40px',
    color: '#6b7280',
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '3px solid #e5e7eb',
    borderTopColor: '#6366f1',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    margin: '0 auto 16px',
  },
  shopOpen: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '12px 16px',
    borderRadius: '12px',
    marginBottom: '24px',
    fontWeight: 500,
    fontSize: '14px',
    background: '#ecfdf5',
    color: '#065f46',
  },
  shopClosed: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '12px 16px',
    borderRadius: '12px',
    marginBottom: '24px',
    fontWeight: 500,
    fontSize: '14px',
    background: '#fef2f2',
    color: '#991b1b',
  },
  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: '#10b981',
    animation: 'pulse 2s infinite',
  },
  queueInfo: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px',
    marginBottom: '24px',
  },
  infoCard: {
    background: '#f9fafb',
    borderRadius: '12px',
    padding: '16px',
    textAlign: 'center' as const,
  },
  infoLabel: {
    fontSize: '12px',
    color: '#6b7280',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    margin: '0 0 4px 0',
  },
  infoValue: {
    fontSize: '24px',
    fontWeight: 700,
    color: '#1f2937',
    margin: 0,
  },
  infoValueGreen: {
    fontSize: '24px',
    fontWeight: 700,
    color: '#10b981',
    margin: 0,
  },
  error: {
    background: '#fef2f2',
    color: '#991b1b',
    padding: '12px 16px',
    borderRadius: '8px',
    fontSize: '14px',
    marginBottom: '16px',
  },
  formGroup: {
    marginBottom: '20px',
  },
  formLabel: {
    display: 'block',
    fontSize: '14px',
    fontWeight: 500,
    color: '#374151',
    marginBottom: '8px',
  },
  formInput: {
    width: '100%',
    padding: '14px 16px',
    fontSize: '16px',
    border: '2px solid #e5e7eb',
    borderRadius: '12px',
    outline: 'none',
    boxSizing: 'border-box' as const,
    fontFamily: 'inherit',
  },
  joinBtn: {
    width: '100%',
    padding: '16px 24px',
    fontSize: '16px',
    fontWeight: 600,
    border: 'none',
    borderRadius: '12px',
    cursor: 'pointer',
    background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
    color: 'white',
    fontFamily: 'inherit',
  },
  joinBtnDisabled: {
    width: '100%',
    padding: '16px 24px',
    fontSize: '16px',
    fontWeight: 600,
    border: 'none',
    borderRadius: '12px',
    cursor: 'not-allowed',
    background: '#d1d5db',
    color: 'white',
    fontFamily: 'inherit',
  },
  leaveBtn: {
    width: '100%',
    padding: '16px 24px',
    fontSize: '16px',
    fontWeight: 600,
    border: 'none',
    borderRadius: '12px',
    cursor: 'pointer',
    background: '#ef4444',
    color: 'white',
    fontFamily: 'inherit',
    marginBottom: '16px',
  },
  tokenDisplay: {
    textAlign: 'center' as const,
    padding: '24px',
    background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
    borderRadius: '16px',
    color: 'white',
    marginBottom: '24px',
  },
  tokenLabel: {
    fontSize: '14px',
    opacity: 0.9,
    margin: '0 0 8px 0',
  },
  tokenNumber: {
    fontSize: '64px',
    fontWeight: 700,
    margin: 0,
    lineHeight: 1,
  },
  tokenName: {
    fontSize: '18px',
    margin: '8px 0 0 0',
    opacity: 0.9,
  },
  statusGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px',
    marginBottom: '24px',
  },
  statusCard: {
    padding: '16px',
    borderRadius: '12px',
    textAlign: 'center' as const,
    background: '#fef3c7',
  },
  statusCardGreen: {
    padding: '16px',
    borderRadius: '12px',
    textAlign: 'center' as const,
    background: '#d1fae5',
  },
  statusValue: {
    fontSize: '28px',
    fontWeight: 700,
    margin: '0 0 4px 0',
    color: '#92400e',
  },
  statusValueGreen: {
    fontSize: '28px',
    fontWeight: 700,
    margin: '0 0 4px 0',
    color: '#065f46',
  },
  statusLabel: {
    fontSize: '12px',
    color: '#4b5563',
    margin: 0,
  },
  servingNow: {
    background: '#f9fafb',
    borderRadius: '12px',
    padding: '16px',
    marginBottom: '24px',
  },
  servingNowTitle: {
    fontSize: '12px',
    color: '#6b7280',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    margin: '0 0 12px 0',
  },
  servingTokens: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '8px',
  },
  servingToken: {
    background: '#10b981',
    color: 'white',
    padding: '8px 16px',
    borderRadius: '20px',
    fontWeight: 600,
    fontSize: '14px',
  },
  noServing: {
    color: '#9ca3af',
    fontStyle: 'italic',
    fontSize: '14px',
  },
  yourTurn: {
    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    color: 'white',
    padding: '24px',
    borderRadius: '16px',
    textAlign: 'center' as const,
    marginBottom: '24px',
  },
  yourTurnIcon: {
    fontSize: '48px',
    display: 'block',
    marginBottom: '12px',
  },
  yourTurnTitle: {
    fontSize: '24px',
    fontWeight: 700,
    margin: '0 0 4px 0',
  },
  yourTurnSub: {
    fontSize: '14px',
    margin: 0,
    opacity: 0.9,
  },
  completed: {
    background: '#f3f4f6',
    padding: '24px',
    borderRadius: '16px',
    textAlign: 'center' as const,
    marginBottom: '24px',
  },
  completedIcon: {
    fontSize: '48px',
    display: 'block',
    marginBottom: '12px',
  },
  completedTitle: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#374151',
    margin: '0 0 4px 0',
  },
  completedSub: {
    fontSize: '14px',
    color: '#6b7280',
    margin: 0,
  },
  updateNote: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    fontSize: '12px',
    color: '#9ca3af',
    margin: 0,
  },
  updateDot: {
    width: '6px',
    height: '6px',
    background: '#10b981',
    borderRadius: '50%',
    animation: 'blink 1s infinite',
  },
};
