# Repo Structure

Snapshot of the current project tree.

```text
.
|-- .env
|-- .github/
|   |-- workflows/
|   |   |-- build-apk.yml
|-- .gitignore
|-- app.json
|-- app_crash_error.txt
|-- eas.json
|-- eslint.config.js
|-- google-services.json
|-- manual_test_guide.md
|-- metro.config.js
|-- package-lock.json
|-- package.json
|-- README.md
|-- test_plan_web_customer.md
|-- tsconfig.json
|-- android/
|   |-- .gitignore
|   |-- build.gradle
|   |-- gradle.properties
|   |-- gradlew
|   |-- gradlew.bat
|   |-- settings.gradle
|   |-- app/
|   |   |-- build.gradle
|   |   |-- debug.keystore
|   |   |-- google-services.json
|   |   |-- proguard-rules.pro
|   |   |-- src/
|   |   |   |-- debug/
|   |   |   |   |-- AndroidManifest.xml
|   |   |   |-- debugOptimized/
|   |   |   |   |-- AndroidManifest.xml
|   |   |   |-- main/
|   |   |   |   |-- AndroidManifest.xml
|   |   |   |   |-- java/
|   |   |   |   |   |-- com/
|   |   |   |   |   |   |-- quevix/
|   |   |   |   |   |   |   |-- MainActivity.kt
|   |   |   |   |   |   |   |-- MainApplication.kt
|   |   |   |   |-- res/
|   |   |   |   |   |-- drawable/
|   |   |   |   |   |   |-- ic_launcher_background.xml
|   |   |   |   |   |   |-- rn_edit_text_material.xml
|   |   |   |   |   |-- mipmap-anydpi-v26/
|   |   |   |   |   |   |-- ic_launcher.xml
|   |   |   |   |   |   |-- ic_launcher_round.xml
|   |   |   |   |   |-- mipmap-hdpi/
|   |   |   |   |   |   |-- ic_launcher.png
|   |   |   |   |   |   |-- ic_launcher_foreground.png
|   |   |   |   |   |   |-- ic_launcher_round.png
|   |   |   |   |   |-- mipmap-mdpi/
|   |   |   |   |   |   |-- ic_launcher.png
|   |   |   |   |   |   |-- ic_launcher_foreground.png
|   |   |   |   |   |   |-- ic_launcher_round.png
|   |   |   |   |   |-- mipmap-xhdpi/
|   |   |   |   |   |   |-- ic_launcher.png
|   |   |   |   |   |   |-- ic_launcher_foreground.png
|   |   |   |   |   |   |-- ic_launcher_round.png
|   |   |   |   |   |-- mipmap-xxhdpi/
|   |   |   |   |   |   |-- ic_launcher.png
|   |   |   |   |   |   |-- ic_launcher_foreground.png
|   |   |   |   |   |   |-- ic_launcher_round.png
|   |   |   |   |   |-- mipmap-xxxhdpi/
|   |   |   |   |   |   |-- ic_launcher.png
|   |   |   |   |   |   |-- ic_launcher_foreground.png
|   |   |   |   |   |   |-- ic_launcher_round.png
|   |   |   |   |   |-- values/
|   |   |   |   |   |   |-- colors.xml
|   |   |   |   |   |   |-- strings.xml
|   |   |   |   |   |   |-- styles.xml
|   |   |   |   |   |-- values-night/
|   |   |   |   |   |   |-- colors.xml
|   |-- gradle/
|   |   |-- wrapper/
|   |   |   |-- gradle-wrapper.jar
|   |   |   |-- gradle-wrapper.properties
|-- app/
|   |-- +html.tsx
|   |-- admin.tsx
|   |-- dashboard.tsx
|   |-- index.tsx
|   |-- _layout.tsx
|-- assets/
|   |-- DarkThemeSplashScreen.jpeg
|   |-- LightThemeSplashScreen.jpeg
|   |-- applogo.jpeg
|   |-- applogo.jpg
|   |-- fonts/
|   |   |-- SpaceMono-Regular.ttf
|   |-- images/
|   |   |-- adaptive-icon.png
|   |   |-- app-image.png
|   |   |-- favicon.png
|   |   |-- icon.png
|   |   |-- partial-react-logo.png
|   |   |-- react-logo.png
|   |   |-- react-logo@2x.png
|   |   |-- react-logo@3x.png
|   |   |-- splash-image.png
|-- backend/
|   |-- .gitignore
|   |-- requirements.txt
|   |-- server.py
|   |-- vercel.json
|   |-- static/
|   |   |-- index.html
|-- components/
|   |-- WebCustomerView.tsx
|-- lib/
|   |-- backendUrl.ts
|   |-- deviceId.ts
|   |-- fetchWithRetry.ts
|   |-- mobileNotifications.ts
|   |-- notificationDebug.ts
|   |-- webPush.ts
|-- public/
|   |-- sw.js
|-- scripts/
|   |-- reset-project.js
|-- src/
|   |-- components/
|   |   |-- FloatingTabBar.tsx
|   |   |-- ui/
|   |   |   |-- Button.tsx
|   |   |   |-- Card.tsx
|   |   |   |-- EmptyState.tsx
|   |   |   |-- Field.tsx
|   |   |   |-- IconCircle.tsx
|   |   |   |-- index.ts
|   |   |   |-- Pill.tsx
|   |   |   |-- PressableScale.tsx
|   |   |   |-- Screen.tsx
|   |   |   |-- Segmented.tsx
|   |   |   |-- Sheet.tsx
|   |   |   |-- StatTile.tsx
|   |   |   |-- Toast.tsx
|   |-- theme/
|   |   |-- tokens.ts
|   |-- utils/
|   |   |-- time.ts
```
