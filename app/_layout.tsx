// app/_layout.tsx
import { NotificationProvider } from "@/contexts/NotificationContext";
import { SelectedPatientProvider } from "@/contexts/SelectedPatientContext";
import * as Notifications from "expo-notifications";
import { Slot, SplashScreen, useRouter, useSegments } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import {
  addDoc,
  collection,
  getDocs,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";

import {
  OnboardingProvider,
  useOnboarding,
} from "../contexts/OnboardingContext";

import { auth, db } from "../lib/firebase";
import { registerForPushNotificationsAsync } from "../lib/notifications";

import {
  cancelMedicationAlarm,
  handleNotificationResponse,
  scheduleSnoozeAlarm,
} from "../services/reminderAlarmService";

SplashScreen.preventAutoHideAsync();

function RootLayoutNav() {
  const router = useRouter();
  const segments = useSegments();
  const { isCompleted, isLoading: onboardingLoading, data } = useOnboarding();

  const [isReady, setIsReady] = useState(false);

  const notificationListenerSetup = useRef(false);
  const authUnsubscribeRef = useRef<any>(null);

  // ─────────────────────────────────────────
  // NOTIFICATION SETUP (RUN ONCE ONLY)
  // ─────────────────────────────────────────
  useEffect(() => {
    if (notificationListenerSetup.current) return;
    notificationListenerSetup.current = true;

    const setupNotifications = async () => {
      await registerForPushNotificationsAsync();
    };

    setupNotifications();

    const subscription = Notifications.addNotificationResponseReceivedListener(
      async (response) => {
        const data = response.notification.request.content.data ?? {};

        const { medicationName, dosage } = data;

        await handleNotificationResponse(
          response,

          // MARK AS TAKEN
          async (id) => {
            const userId = auth.currentUser?.uid;
            if (!userId || !id) return;

            const dk = new Date().toDateString();
            const baseReminderId = id.split("_").slice(0, 2).join("_");

            await addDoc(collection(db, "users", userId, "taken_logs"), {
              medicationId: id,
              reminderId: baseReminderId,
              name: medicationName || "Medication",
              dosage: dosage || "",
              takenAt: serverTimestamp(),
              dateKey: dk,
            });
          },

          // SNOOZE
          async (id) => {
            await scheduleSnoozeAlarm(
              id,
              medicationName || "Medication",
              dosage || "",
              10,
            );
          },

          // SKIP
          async (id) => {
            await cancelMedicationAlarm(id);
          },
        );
      },
    );

    return () => {
      subscription.remove();
    };
  }, []);

  // ─────────────────────────────────────────
  // AUTH + ROUTING LOGIC
  // ─────────────────────────────────────────
  useEffect(() => {
    authUnsubscribeRef.current = onAuthStateChanged(auth, async (user) => {
      await new Promise((r) => setTimeout(r, 300));

      const currentRoute = segments[0];

      if (user) {
        if (user.emailVerified) {
          if (onboardingLoading) return;

          const userType = data?.userData?.userType || "patient";

          let hasPatients = true;

          if (userType === "caregiver") {
            try {
              const q = query(
                collection(db, "caregiver_connections"),
                where("caregiverId", "==", user.uid),
                where("status", "==", "approved"),
              );

              const snapshot = await getDocs(q);
              hasPatients = snapshot.docs.length > 0;
            } catch {
              hasPatients = false;
            }
          }

          const outsideTabRoutes = [
            "patient-info",
            "edit-profile",
            "caregiver",
            "notifications",
            "medication-logs",
          ];

          const isOutside = outsideTabRoutes.includes(currentRoute);

          if (isCompleted) {
            if (userType === "caregiver" && !hasPatients) {
              if (currentRoute !== "(caregiver-only)") {
                router.replace("/(caregiver-only)/connect");
              }
            } else {
              if (!isOutside && currentRoute !== "(tabs)") {
                router.replace("/(tabs)");
              }
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

    return () => authUnsubscribeRef.current?.();
  }, [isCompleted, onboardingLoading, data?.userData?.userType, segments]);

  // ─────────────────────────────────────────
  // LOADING SCREEN
  // ─────────────────────────────────────────
  if (!isReady || onboardingLoading) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  return <Slot />;
}

// ─────────────────────────────────────────
// ROOT WRAPPER
// ─────────────────────────────────────────
export default function RootLayout() {
  return (
    <OnboardingProvider>
      <NotificationProvider>
        <SelectedPatientProvider>
          <RootLayoutNav />
        </SelectedPatientProvider>
      </NotificationProvider>
    </OnboardingProvider>
  );
}
