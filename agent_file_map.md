# Agent File Map

This map gives short, practical summaries so agents can quickly understand where logic lives.

## Root Files

- `.env`: Frontend runtime environment values (currently sets `EXPO_PUBLIC_BACKEND_URL`).
- `.gitignore`: Root ignore rules for Node/Expo/Metro/Python artifacts and local secrets.
- `app.json`: Expo app metadata, plugin setup, package IDs, web/static and splash/icon config.
- `app_crash_error.txt`: Captured Android crash stack trace (`NoClassDefFoundError` related to Expo activity handler).
- `eas.json`: EAS build profiles (`development`, `preview`, `production`, `production-aab`) and submit config.
- `eslint.config.js`: Flat ESLint config using Expo defaults plus `dist/*` ignore.
- `google-services.json`: Firebase Android configuration used by React Native Firebase.
- `manual_test_guide.md`: Step-by-step UI flow test plan for verifying tasks 1-11 performance/UX changes (excludes deferred tasks 5 and 9).
- `metro.config.js`: Metro bundler config with persistent disk cache and reduced workers.
- `package-lock.json`: NPM lockfile for deterministic installs.
- `package.json`: Scripts, Expo/React Native dependencies, and project package metadata.
- `README.md`: Default Expo template readme with getting-started instructions.
- `tsconfig.json`: TypeScript config extending Expo base with strict mode and `@/*` path alias.
- `test_plan_web_customer.md`: Manual QA test plan for the customer queue web UI (rejoin-after-completion flow and join-button UX changes).

## Frontend Routes (`app/`)

- `app/_layout.tsx`: Global app shell with custom header/drawer navigation and notification permission/init hooks.
- `app/index.tsx`: Customer queue screen (shop selection, join queue, status polling, leave/rejoin, local persistence).
- `app/dashboard.tsx`: Barber dashboard (shop login, queue operations, polling, push registration, filters).
- `app/admin.tsx`: Admin panel (admin login, shop CRUD, barber management, stats, reset/remove token actions).
- `app/+html.tsx`: Web HTML wrapper for Expo Router with scroll reset and DOM-level layout fixes.

## Shared Component

- `components/WebCustomerView.tsx`: Web-only customer queue UI using browser storage and 5s polling.

## Shared Library (`lib/`)

- `lib/backendUrl.ts`: Resolves backend base URL from env, Expo host, and Android defaults.
- `lib/fetchWithRetry.ts`: Fetch wrapper adding per-request timeout (AbortController) and exponential-backoff retries for idempotent GETs only; mutations get timeouts but no auto-retry to avoid duplicates.
- `lib/mobileNotifications.ts`: FCM registration/unregistration, permission flow, and foreground/background handlers.
- `lib/notificationDebug.ts`: AsyncStorage-based debug log store for notification troubleshooting.
- `lib/webPush.ts`: Browser push subscription helper using service workers + VAPID flow.

## Backend (`backend/`)

- `backend/.gitignore`: Backend-specific ignore rules (contains `.vercel`, service-account ignore, plus an extra command line string).
- `backend/requirements.txt`: Python dependency list (FastAPI, Motor/PyMongo, Firebase Admin, etc.).
- `backend/server.py`: Main FastAPI app with queue/shop/barber APIs, MongoDB models, and notification dispatch logic.
- `backend/vercel.json`: Vercel build and route config for Python API + static file serving.
- `backend/static/index.html`: Customer-facing QR-scan queue web page with join/status polling, leave, and rejoin-after-completion flow.

## Public Web Assets

- `public/sw.js`: Web service worker handling push events and notification click routing.

## Scripts

- `scripts/reset-project.js`: Expo starter reset script that can archive/delete app scaffolding and recreate base app files.

## Android Native Project (`android/`)

### Android Root

- `android/.gitignore`: Android/Gradle/IDE generated files ignore list.
- `android/build.gradle`: Top-level Gradle config and plugin/classpath declarations.
- `android/gradle.properties`: Global Gradle/React Native/Expo flags, architecture, Hermes, signing props.
- `android/gradlew`: Unix Gradle wrapper script.
- `android/gradlew.bat`: Windows Gradle wrapper script.
- `android/settings.gradle`: Module includes and React Native + Expo autolinking setup.

### Android App Module

- `android/app/build.gradle`: App module build config, RN/Expo integration, signing, build types, dependencies.
- `android/app/debug.keystore`: Debug signing key for local/debug Android builds.
- `android/app/google-services.json`: Module-level Firebase config used by Android app build.
- `android/app/proguard-rules.pro`: ProGuard keep rules (notably for Reanimated and TurboModules).

### Android Manifests

- `android/app/src/main/AndroidManifest.xml`: Main app manifest with permissions, app/activity config, deep link scheme.
- `android/app/src/debug/AndroidManifest.xml`: Debug manifest override enabling cleartext traffic and debug extras.
- `android/app/src/debugOptimized/AndroidManifest.xml`: Debug optimized manifest override (same cleartext setup).

### Android Kotlin Entry Points

- `android/app/src/main/java/app/emergent/salonqueue13480893b7/MainActivity.kt`: React activity bootstrap and splash/new-arch delegate wiring.
- `android/app/src/main/java/app/emergent/salonqueue13480893b7/MainApplication.kt`: React application host setup and Expo lifecycle integration.

### Android Resources

- `android/app/src/main/res/drawable/ic_launcher_background.xml`: Launcher background layer list.
- `android/app/src/main/res/drawable/rn_edit_text_material.xml`: Patched EditText drawable selector to avoid known RN crash.
- `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`: Adaptive launcher icon definition.
- `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml`: Adaptive round launcher icon definition.
- `android/app/src/main/res/mipmap-hdpi/ic_launcher.webp`: HDPI launcher icon asset.
- `android/app/src/main/res/mipmap-hdpi/ic_launcher_foreground.webp`: HDPI launcher foreground asset.
- `android/app/src/main/res/mipmap-hdpi/ic_launcher_round.webp`: HDPI round launcher icon asset.
- `android/app/src/main/res/mipmap-mdpi/ic_launcher.webp`: MDPI launcher icon asset.
- `android/app/src/main/res/mipmap-mdpi/ic_launcher_foreground.webp`: MDPI launcher foreground asset.
- `android/app/src/main/res/mipmap-mdpi/ic_launcher_round.webp`: MDPI round launcher icon asset.
- `android/app/src/main/res/mipmap-xhdpi/ic_launcher.webp`: XHDPI launcher icon asset.
- `android/app/src/main/res/mipmap-xhdpi/ic_launcher_foreground.webp`: XHDPI launcher foreground asset.
- `android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.webp`: XHDPI round launcher icon asset.
- `android/app/src/main/res/mipmap-xxhdpi/ic_launcher.webp`: XXHDPI launcher icon asset.
- `android/app/src/main/res/mipmap-xxhdpi/ic_launcher_foreground.webp`: XXHDPI launcher foreground asset.
- `android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.webp`: XXHDPI round launcher icon asset.
- `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.webp`: XXXHDPI launcher icon asset.
- `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.webp`: XXXHDPI launcher foreground asset.
- `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.webp`: XXXHDPI round launcher icon asset.
- `android/app/src/main/res/values/colors.xml`: Android color resources (theme + splash/icon background).
- `android/app/src/main/res/values/strings.xml`: App name and Expo system UI string resources.
- `android/app/src/main/res/values/styles.xml`: App theme definition and status/input styling.
- `android/app/src/main/res/values-night/colors.xml`: Night-mode color override file (currently empty).

### Android Gradle Wrapper

- `android/gradle/wrapper/gradle-wrapper.jar`: Gradle wrapper binary.
- `android/gradle/wrapper/gradle-wrapper.properties`: Gradle wrapper distribution/version settings.

## App Assets (`assets/`)

- `assets/applogo.jpg`: Branded app logo image.
- `assets/fonts/SpaceMono-Regular.ttf`: Included custom font asset.
- `assets/images/adaptive-icon.png`: Source image for Android adaptive icon.
- `assets/images/app-image.png`: General app visual/branding image.
- `assets/images/favicon.png`: Web favicon image.
- `assets/images/icon.png`: Primary app icon source image.
- `assets/images/partial-react-logo.png`: Template/starter React graphic asset.
- `assets/images/react-logo.png`: Template/starter React logo asset.
- `assets/images/react-logo@2x.png`: 2x density React logo asset.
- `assets/images/react-logo@3x.png`: 3x density React logo asset.
- `assets/images/splash-image.png`: Splash screen image used by Expo splash plugin.
