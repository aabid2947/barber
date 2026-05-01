# Manual Test Guide — Performance & UX Changes

How to verify the fixes shipped across tasks 1, 2, 3, 4, 6, 7, 8, 10, and 11. Tasks 5 (real-time listeners) and 9 (RTK Query) are deferred pending confirmation and are **not** in the build.

Each section lists: **what changed**, **steps to reproduce in the UI**, and **pass criteria** — what you should observe if the fix is working.

---

## Preflight

1. Pull latest, install deps, run an EAS build (or `expo run:android` for a dev build) since several changes are inside the React Native app.
2. Backend deploys on Vercel — push the backend changes (`backend/server.py`) to your Vercel project so the new `BackgroundTasks` and projection-tightened endpoints are live.
3. For the test runs, have **two devices** ready when possible: one on the customer screen ([app/index.tsx](app/index.tsx)), one on the barber dashboard ([app/dashboard.tsx](app/dashboard.tsx)). The admin panel ([app/admin.tsx](app/admin.tsx)) is a third role.
4. Sign in to one shop with a known username/password. Have at least 3 chairs configured (`activeBarbers >= 3`) so multi-chair tests are visible.
5. Open device logs (`adb logcat | grep -E "JOIN|FCM|NOTIFY"`) if you want to confirm background tasks are firing.

---

## 1. Customer "Join Queue" feels instant

**What changed**
- Backend FCM barber-notify moved to a background task; HTTP join response returns before FCM round-trip.
- Client flips to the joined-token screen the same render as the response; AsyncStorage writes + push registration deferred.

**Steps**
1. On the customer screen, pick an open shop.
2. Type a name and tap **JOIN QUEUE**.

**Pass criteria**
- ✅ The button shows a small spinner immediately (already true before — confirms baseline).
- ✅ As soon as the network response lands, the screen flips to "Now Serving / Token #N / People ahead". This should feel near-instant (< 1s on a normal connection).
- ✅ No multi-second pause between the button spinner and the token screen appearing.
- ✅ A few seconds after the screen flips, the barber's device receives an FCM "New Queue Entry" notification (background-task delivery).

**Negative test**
- Tap **JOIN QUEUE** twice rapidly. The second tap should be a no-op (button is `disabled` while loading).

---

## 2. Customer screen renders shops without a full-screen loader

**What changed**
- Shop list cached in `AsyncStorage` under `@shops_cache_v1`. The full-screen "Loading shops..." gate is removed; the brand header always paints first.
- `fetchShops` is now cache-first → render → background network refresh → write back to cache.

**Steps**
1. Force-quit the customer app. Open it again — this is the **first ever launch** path (no cache).
2. Force-quit again, reopen — this is the **repeat launch** path (cache present).

**Pass criteria**
- ✅ **First launch**: brand header ("Quevix · Smart Queue Platform") appears immediately. Below it, an inline "Loading shops…" row shows for ~500ms while the network responds. Then shops fill in.
- ✅ **Repeat launch**: shops list renders **on first paint** with no loader at all. Network refresh happens silently in the background.
- ✅ At no point should the entire screen be a centered spinner with nothing else on it.

---

## 3. Barber dashboard actions feel instant

**What changed**
- DONE / SKIP / CALL NEXT use optimistic UI: chair cards update on the same render as the tap.
- Buttons disable themselves and grey out while the network call is in flight (`pendingActions` set).
- Backend `done` / `skip` / `start-next` move FCM notifications to background tasks.

**Steps (DONE)**
1. With one customer being served on Chair 1 and at least one waiting in line, tap **DONE** on Chair 1.
2. Confirm the modal.

**Pass criteria**
- ✅ Modal disappears instantly (no fade — see task 4).
- ✅ The chair card shows the next-in-line customer immediately (or "Empty" if no one is waiting). No "loading" intermediate state.
- ✅ During the in-flight period (you may not even see it on a fast network), the DONE button is greyed out and unresponsive to taps.

**Steps (SKIP)** — same as DONE, with the SKIP button.

**Steps (CALL NEXT)**
1. With at least one waiting customer and an empty chair, tap **CALL NEXT** on the empty chair.

**Pass criteria**
- ✅ Chair fills with the waiting customer instantly.
- ✅ CALL NEXT button on that chair greys out while in flight; no double-promotion if you tap rapidly.
- ✅ Waiting list count drops by 1 immediately.

**Negative test**
- Tap DONE / SKIP / CALL NEXT multiple times rapidly during the in-flight window. Only **one** mutation should hit the backend (verify by counting tokens or checking server logs).

---

## 4. Confirmation modal name doesn't linger

**What changed**
- `<Modal animationType>` changed from `"fade"` → `"none"`. The modal (with its "Complete service for #5 (Alex)?" text) was fading over the chair card for ~300ms+ on slower devices, making the name look like it lingered.

**Steps**
1. Tap **DONE** on a chair to open the confirm modal.
2. Tap **Done** in the modal.

**Pass criteria**
- ✅ The modal disappears in the **same frame** as the chair card updates. There should be no perceptible "name fading out" period.
- ✅ Same behaviour for **SKIP**.

---

## 6. All chairs render at once (no chair-by-chair pop-in)

**What changed**
- Dashboard data cached per-shop in `@dashboard_cache_v1:<shopId>:<barberFilter|all>`. On mount, cache hydrates first so `data.activeBarbers` is correct on first paint and the chair loop renders all N chairs.
- The misleading `data?.activeBarbers || 1` fallback is gone; first-ever login shows an inline "Loading chairs…" row instead of a single placeholder chair.

**Steps**
1. **First-ever login**: clear the app data (or sign in to a shop on a fresh device). Log in.
2. **Repeat login**: log out and log back in.
3. Make sure the shop has `activeBarbers >= 3`.

**Pass criteria**
- ✅ **First-ever login**: an inline "Loading chairs…" row shows briefly, then **all 3 chairs appear simultaneously**.
- ✅ **Repeat login**: all 3 chairs render on first paint, no loader at all. Cached state may be slightly stale; it reconciles silently within ~500ms.
- ✅ At no point should you see 1 chair appear, then 2, then 3 over the course of 2-3 seconds.

---

## 7. Admin panel shop list loads instantly on repeat logins

**What changed**
- Admin shop list cached in `@admin_shops_cache_v1`. Cache-first read on `fetchShops`.
- Backend `/admin/shops` now uses a Mongo projection `{_id: 0, password: 0}` instead of looping pop().
- Cache cleared on logout for hygiene.

**Steps**
1. **First-ever admin login**: clear app data, sign in to admin.
2. **Repeat admin login**: log out, log back in.
3. Create a shop, edit it, delete one — verify the list updates.

**Pass criteria**
- ✅ **First-ever**: shop list takes the cold network round-trip (~1-2s on slow connections).
- ✅ **Repeat**: shop list appears **on first paint** from cache. Network refresh updates silently in the background.
- ✅ Create/update/delete still update the list correctly (mutation handlers call `fetchShops` which re-hits the network and overwrites cache).
- ✅ After **logout**, the cache is cleared — verify by checking AsyncStorage in dev tools, or by re-logging in and seeing the cache rebuild from scratch.

---

## 8. No full queue reload after each action

**What changed**
- The blanket `fetchDashboard()` call in the `finally` of every dashboard mutation handler is gone. On success, the optimistic state stands. `fetchDashboard()` only fires on error.
- `handleAddCustomer` now appends the new entry to `waitingList` locally instead of refetching the whole dashboard.
- The 15s safety-net poll is still in place for unrelated changes.

**Steps**
1. Open the barber dashboard. In the browser/proxy, watch the network panel (or `adb logcat` for HTTP traffic).
2. Tap **DONE** on a chair → confirm.
3. Tap **CALL NEXT** on an empty chair.
4. Add a customer with **ADD**.

**Pass criteria**
- ✅ For each successful action, you should see **only the mutation request** (`POST /done/...`, `POST /start-next`, `POST /queue/join`). **No subsequent `GET /dashboard` request** should follow within the same action.
- ✅ Every 15s, you should still see a single safety `GET /session-status` + `GET /dashboard` poll. That's expected — it's not "after each action."
- ✅ If you simulate failure (e.g., kill backend mid-action), then a recovery `GET /dashboard` fires from the error path. Restore backend, normal flow resumes.

---

## 10. All buttons respond instantly with disable + spinner

**What changed**
- Customer Leave-Queue confirm button: new `leaving` state → button disables + shows spinner.
- Dashboard ADD Customer button: now uses `pendingActions.has('add-customer')` for disable + spinner.
- Admin: shared `busy: Set<string>` with helper functions, applied to **9** mutation handlers and their corresponding buttons (Create Shop, Update Shop, Delete Shop, Toggle Shop Status, Reset Day, Reset Session, Remove Token, Add Barber, Delete Barber).

**Steps for each button**
1. Trigger the button. Watch carefully during the in-flight window.
2. Try double-tapping rapidly.

**Pass criteria for every button below**
- ✅ Button visibly greys out (opacity 0.5) the same frame as the tap.
- ✅ Button label is replaced by a small `ActivityIndicator` while the network call is running.
- ✅ Repeat taps during in-flight do nothing (verify in network panel: only one request per single tap).

**Buttons to test**

Customer screen: **JOIN QUEUE** (already had this, regression check), **Leave (modal confirm)**.

Barber dashboard: **DONE**, **SKIP**, **CALL NEXT**, **ADD** (add customer), **modal Confirm**.

Admin panel:
- **Create Shop modal → Create**
- **Edit shop → SAVE**
- **Toggle shop status → CLOSE SHOP / OPEN SHOP**
- **Delete shop modal → Delete**
- **Reset Day modal → Reset**
- **Reset Session modal → Reset**
- **Remove Token modal → Remove**
- **Add Barber modal → Add**
- **Per-barber → Remove** (each row's delete button is independent — disabling one row should not disable others)

---

## 11. Network handling — slow / flaky connections

**What changed**
- New `lib/fetchWithRetry.ts` wraps `fetch` with timeout (15s default) and exponential-backoff retries (500ms → 1s → 2s) for **GET/HEAD only**.
- Mutations get the timeout but never auto-retry — duplicate-tap protection stays on the client guards from task 10.
- Wired into hot-path GETs (`fetchShops`, `refreshStatus`, `fetchDashboard`, admin `fetchShops`) and hot-path mutations (`handleJoinQueue`, `confirmLeaveQueue`, `handleDone` / `handleSkip` / `handleStartNext` / `handleStart` / `handleAddCustomer`).

### 11.1 Timeout — UI doesn't hang forever

**Steps**
1. Put the device in airplane mode.
2. On the dashboard, tap **DONE** on a chair.

**Pass criteria**
- ✅ Optimistic UI updates immediately (chair clears).
- ✅ DONE button is greyed and disabled.
- ✅ After ~15s, the optimistic state rolls back via the error-path `fetchDashboard()` (or a "⚠ Network error — refreshing" toast appears).
- ✅ Button re-enables. The UI is **not** stuck pending forever.

### 11.2 Retry on transient GET failure

**Steps**
1. Use a network proxy (Charles, mitmproxy) or a "flaky network" simulator. Configure it to drop the first request to `/dashboard` then let the retry through.
2. Open the dashboard.

**Pass criteria**
- ✅ Dashboard data still loads despite the dropped first request — you should see two requests in the proxy log, second one succeeding ~500ms after the first.
- ✅ User sees no error; the retry is silent.

**Cheaper alternative**: temporarily edit the backend to return a `503` from `/dashboard` for the next request, then `200` after. Same behaviour.

### 11.3 Mutations don't double-fire

**Steps**
1. Use the proxy to drop the response to a `POST /done/...` request after the backend processes it.
2. Tap **DONE** on a chair.

**Pass criteria**
- ✅ Only **one** `POST /done/...` request is sent. The retry policy correctly treats the POST as non-idempotent and **does not** auto-retry.
- ✅ After the 15s timeout, the error path runs `fetchDashboard()` which reconciles the UI with the (already-completed) backend state. The customer who was DONE doesn't end up double-completed.

### 11.4 Slow connection — 3G simulation

**Steps**
1. Use Android dev settings → Quick Settings → Network throttling, or in your proxy set the connection to "3G slow" (~400 Kbps, 200ms latency).
2. Use the app normally.

**Pass criteria**
- ✅ Optimistic UI still feels instant (it's local).
- ✅ Polling still works — dashboard still updates every ~15-20s.
- ✅ No request ever hangs longer than 15s; failures surface as toasts instead of indefinite loaders.

---

## What is NOT in this build (deferred)

- **Task 5: real-time updates < 1s.** Awaiting confirmation between Firestore (recommended) vs WebSocket (requires backend migration off Vercel) vs FCM silent push. Polling at 15s is the current real-time mechanism.
- **Task 9: RTK Query state management.** Awaiting confirmation on scope, persistence, and optimistic-update migration strategy. Local state still uses `useState` with manual optimistic updates.

If you want either of these moved forward, reply on the relevant task with the choices listed in the original responses.

---

## Quick smoke test (5-minute end-to-end)

If you have only a few minutes, this single sequence touches the most-changed paths:

1. **Repeat customer launch**: open customer app → shops appear instantly (task 2).
2. **Join queue**: tap shop → name → JOIN → token screen appears in <1s (task 1, task 11 timeout).
3. **Repeat barber login**: open dashboard app → log in → all chairs render at once (task 6).
4. **Action sequence**: tap CALL NEXT → DONE on resulting chair → SKIP on next, all without modal-fade lag (tasks 3, 4, 8). Verify only mutation requests fire — no follow-up GET dashboard (task 8).
5. **Add customer**: ADD button shows spinner → customer appears in waiting list with no full reload (tasks 8, 10).
6. **Admin repeat login**: shops list paints from cache (task 7).

If all six steps feel fast and snappy with no chair pop-in or modal lag, the build is good.
