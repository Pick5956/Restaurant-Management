import Ionicons from '@expo/vector-icons/Ionicons';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, type ReactNode } from 'react';
import { Platform, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { TabletWorkspaceFrame } from '@/src/components/app-shell';
import { AuthProvider } from '@/src/providers/auth-provider';
import { PrinterProvider } from '@/src/providers/printer-provider';
import { ToastProvider } from '@/src/providers/toast-provider';
import {
  DisplayPreferencesProvider,
  useDisplayPreferences,
} from '@/src/providers/display-preferences-provider';
import { APP_FONT_FAMILIES } from '@/src/lib/app-font';
import { orientationLockFor } from '@/src/lib/orientation-lock';
import { colors } from '@/src/theme';

export {
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  initialRouteName: 'index',
};

const topLevelScreenOptions = {
  animation: 'none' as const,
  gestureEnabled: false,
};

SplashScreen.preventAutoHideAsync();

const bundledFonts = {
  ...Ionicons.font,
  [APP_FONT_FAMILIES.regular]: require('../assets/fonts/Kanit-Regular.ttf'),
  [APP_FONT_FAMILIES.medium]: require('../assets/fonts/Kanit-Medium.ttf'),
  [APP_FONT_FAMILIES.semiBold]: require('../assets/fonts/Kanit-SemiBold.ttf'),
  [APP_FONT_FAMILIES.bold]: require('../assets/fonts/Kanit-Bold.ttf'),
};

function TabletWorkspaceStackLayout({ children }: { children: ReactNode }) {
  return <TabletWorkspaceFrame>{children}</TabletWorkspaceFrame>;
}

// Pin phones to upright portrait and tablets to landscape, so the POS, kitchen
// board and table grid always get the shape they were designed for. The effect
// keys off the resolved mode rather than the raw dimensions, so turning a device
// does not churn lock calls - the mode is derived from the smallest side, which
// rotation never changes.
//
// LANDSCAPE (not LANDSCAPE_LEFT) keeps both sideways positions, so a tablet can
// be flipped either way on its stand without the home button ending up wherever
// the cable is not.
//
// iPad caveat: iOS ignores orientation locks while an app supports Slide Over /
// Split View, so this only takes effect with ios.requireFullScreen set in
// app.json - and never inside Expo Go, which ships its own Info.plist.
function useOrientationLock() {
  const { width, height } = useWindowDimensions();
  const mode = orientationLockFor({ width, height });

  useEffect(() => {
    // react-native-web has no equivalent lock and throws on desktop browsers.
    if (Platform.OS === 'web') return;
    // Dimensions are not readable yet; leave whatever the system is doing.
    if (!mode) return;

    void (async () => {
      try {
        await ScreenOrientation.lockAsync(
          mode === 'portrait'
            ? ScreenOrientation.OrientationLock.PORTRAIT_UP
            : ScreenOrientation.OrientationLock.LANDSCAPE,
        );
      } catch {
        // Orientation control is a nicety - never let it break startup.
      }
    })();
  }, [mode]);
}

function AppNavigator() {
  const { ready } = useDisplayPreferences();
  const [fontsLoaded, fontError] = useFonts(bundledFonts);

  useEffect(() => {
    if (ready && (fontsLoaded || fontError)) void SplashScreen.hideAsync();
  }, [fontError, fontsLoaded, ready]);

  if (!ready || (!fontsLoaded && !fontError)) {
    return <View style={{ flex: 1, backgroundColor: colors.surface }} />;
  }

  return (
    <AuthProvider>
      <PrinterProvider>
        <Stack
          layout={TabletWorkspaceStackLayout}
          screenOptions={{
            headerShown: false,
            animation: 'slide_from_right',
            gestureEnabled: true,
            presentation: 'card',
            contentStyle: { backgroundColor: colors.surface },
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
          <Stack.Screen name="register" />
          <Stack.Screen name="restaurants" />
          <Stack.Screen name="create-restaurant" />
          <Stack.Screen name="invite/manual" />
          <Stack.Screen name="invite/[token]" />
          <Stack.Screen name="(primary)" options={topLevelScreenOptions} />
          {/*
            Reservation history is reached from the table screens rather than
            from a menu entry of its own. It used to carry `presentation: 'modal'`
            to mirror how the web opens it over /pos/tables — but on a phone a
            modal is the sheet that slides up from the bottom over a dimmed
            backdrop, which is the grammar for "a decision to make before you can
            go on". This is a screen you walk into and back out of, so it takes
            the stack's own slide-from-the-right like every other push.
          */}
          <Stack.Screen name="reservations" />
          <Stack.Screen name="table-reservation" />
          <Stack.Screen name="table-management" />
          <Stack.Screen name="table-management/table" />
          <Stack.Screen name="table-management/zones" />
          <Stack.Screen name="table-management/tags" />
          <Stack.Screen name="order/[id]" />
          <Stack.Screen name="order/new" />
          <Stack.Screen name="menu" />
          <Stack.Screen name="staff" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="settings/printer" />
          <Stack.Screen name="inventory" />
          <Stack.Screen name="reports" />
          <Stack.Screen name="ai-assistant" />
        </Stack>
      </PrinterProvider>
    </AuthProvider>
  );
}

export default function RootLayout() {
  useOrientationLock();

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      {/* SDK 57 removed backgroundColor from StatusBar: Android draws
          edge-to-edge, so the bar is transparent and the view behind it shows
          through. The wrapping View already paints colors.surface there. */}
      <StatusBar style="dark" />
      <SafeAreaProvider>
        <DisplayPreferencesProvider>
          <ToastProvider>
            <AppNavigator />
          </ToastProvider>
        </DisplayPreferencesProvider>
      </SafeAreaProvider>
    </View>
  );
}
