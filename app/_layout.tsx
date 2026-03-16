// app/_layout.tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { Slot, SplashScreen, useRouter, useSegments } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { doc, updateDoc } from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { OnboardingProvider } from "../contexts/OnboardingContext";
import { auth, db } from "../lib/firebase";
import {
  registerBackgroundTask,
  requestNotificationPermissions,
  setupNotificationChannel,
} from "../lib/notifications";

const ONBOARDING_COMPLETED_KEY = "@medguard_onboarding_completed";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const [isReady, setIsReady] = useState(false);
  const notificationResponseSub = useRef<any>(null);
  const notificationReceivedSub = useRef<any>(null);

  // ─── Notification setup ───────────────────────
  useEffect(() => {
    const setupNotifications = async () => {
      await setupNotificationChannel();
      await requestNotificationPermissions();
      await registerBackgroundTask();
    };

    setupNotifications();

    // Auto-disable one-time reminders when notification is received
    notificationReceivedSub.current =
      Notifications.addNotificationReceivedListener(async (notification) => {
        const { reminderId, isOneTime } =
          notification.request.content.data ?? {};
        if (isOneTime && reminderId) {
          const userId = auth.currentUser?.uid;
          if (userId) {
            await updateDoc(doc(db, "users", userId, "reminders", reminderId), {
              enabled: false,
            });
          }
        }
      });

    // Also handle when user taps the notification
    notificationResponseSub.current =
      Notifications.addNotificationResponseReceivedListener(
        async (response) => {
          const { reminderId, isOneTime } =
            response.notification.request.content.data ?? {};
          if (isOneTime && reminderId) {
            const userId = auth.currentUser?.uid;
            if (userId) {
              await updateDoc(
                doc(db, "users", userId, "reminders", reminderId),
                { enabled: false },
              );
            }
          }
        },
      );

    return () => {
      notificationReceivedSub.current?.remove();
      notificationResponseSub.current?.remove();
    };
  }, []);

  // ─── Auth + onboarding check ──────────────────
  useEffect(() => {
    const checkAuthAndOnboarding = async () => {
      try {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
          console.log(
            "Auth state changed:",
            user?.email,
            "verified:",
            user?.emailVerified,
          );

          await new Promise((resolve) => setTimeout(resolve, 500));

          const currentRoute = segments[0];
          console.log("Current route:", currentRoute);

          if (user) {
            if (user.emailVerified) {
              const onboardingCompleted = await AsyncStorage.getItem(
                `${ONBOARDING_COMPLETED_KEY}_${user.uid}`,
              );

              console.log("Onboarding completed:", onboardingCompleted);

              if (onboardingCompleted === "true") {
                if (currentRoute !== "(tabs)") {
                  router.replace("/(tabs)");
                }
              } else {
                if (currentRoute !== "(onboarding)") {
                  router.replace("/(onboarding)/stepper");
                }
              }
            } else {
              if (currentRoute !== "(auth)") {
                router.replace("/(auth)/verify-email");
              }
            }
          } else {
            if (currentRoute !== "(auth)") {
              router.replace("/(auth)/onboarding");
            }
          }

          setIsReady(true);
          SplashScreen.hideAsync();
        });

        return unsubscribe;
      } catch (error) {
        console.error("Auth check error:", error);
        setIsReady(true);
        SplashScreen.hideAsync();
        return () => {};
      }
    };

    checkAuthAndOnboarding();
  }, [segments]);

  if (!isReady) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  return (
    <OnboardingProvider>
      <Slot />
    </OnboardingProvider>
  );
}
