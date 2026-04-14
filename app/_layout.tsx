// app/_layout.tsx
import { NotificationProvider } from "@/contexts/NotificationContext";
import { SelectedPatientProvider } from "@/contexts/SelectedPatientContext";
import * as Notifications from "expo-notifications";
import { Slot, SplashScreen, useRouter, useSegments } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where
} from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import {
  OnboardingProvider,
  useOnboarding,
} from "../contexts/OnboardingContext";
import { auth, db } from "../lib/firebase";
import {
  registerBackgroundTask,
  requestNotificationPermissions,
  setupNotificationChannel,
} from "../lib/notifications";
import {
  cancelMedicationAlarm,
  handleNotificationResponse,
  scheduleSnoozeAlarm,
} from "../services/reminderAlarmService";


const ONBOARDING_COMPLETED_KEY = "@medguard_onboarding_completed";

SplashScreen.preventAutoHideAsync();

// Separate component that uses the onboarding context
function RootLayoutNav() {
  const router = useRouter();
  const segments = useSegments();
  const { isCompleted, isLoading: onboardingLoading, data } = useOnboarding();
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

    notificationResponseSub.current =
      Notifications.addNotificationResponseReceivedListener(
        async (response) => {
          const data = response.notification.request.content.data ?? {};
          const { reminderId, medicationName, dosage } = data;

          await handleNotificationResponse(
            response,
            async (id) => {
              const userId = auth.currentUser?.uid;
              if (userId && id) {
                const dk = new Date().toDateString();
                try {
                  const baseReminderId = id.split("_").slice(0, 2).join("_");
                  await addDoc(collection(db, "users", userId, "taken_logs"), {
                    medicationId: id,
                    reminderId: baseReminderId,
                    name: medicationName || "Medication",
                    dosage: dosage || "",
                    takenAt: serverTimestamp(),
                    dateKey: dk,
                  });
                  console.log(
                    "✅ Medication marked as taken from notification",
                  );
                } catch (error) {
                  console.error("Error marking as taken:", error);
                }
              }
            },
            async (id) => {
              console.log("⏰ Snoozing reminder:", id);
              await scheduleSnoozeAlarm(
                id,
                medicationName || "Medication",
                dosage || "",
                10,
              );
            },
            async (id) => {
              console.log("❌ Skipping reminder:", id);
              await cancelMedicationAlarm(id);
            },
          );
        },
      );

    return () => {
      notificationReceivedSub.current?.remove();
      notificationResponseSub.current?.remove();
    };
  }, []);

  // ─── Auth + routing logic ──────────────────
  useEffect(() => {
    const checkAuthAndOnboarding = async () => {
      try {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
          await new Promise((resolve) => setTimeout(resolve, 500));

          const currentRoute = segments[0];

          if (user) {
            if (user.emailVerified) {
              if (onboardingLoading) {
                console.log("⏳ Waiting for onboarding context to load...");
                return;
              }

              console.log("📋 Onboarding completed from context:", isCompleted);
              console.log("👤 User type:", data?.userData?.userType);
              console.log("📍 Current route:", currentRoute);

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
                  console.log("Caregiver has patients:", hasPatients);
                } catch (e) {
                  console.warn("Could not check caregiver patients:", e);
                  hasPatients = false;
                }
              }

              // ✅ List of routes that are outside the tabs (modals, etc.)
              const outsideTabRoutes = [
                "patient-info",
                "edit-profile",
                "caregiver",
                "notifications",
                "medication-logs",
              ];

              const isOutsideTabRoute = outsideTabRoutes.includes(currentRoute);

              if (isCompleted === true) {
                if (userType === "caregiver" && hasPatients === false) {
                  if (currentRoute !== "(caregiver-only)") {
                    router.replace("/(caregiver-only)/connect");
                  }
                } else {
                  // ✅ Only redirect to tabs if we're not on an outside-tab route
                  if (!isOutsideTabRoute && currentRoute !== "(tabs)") {
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

        return unsubscribe;
      } catch (error) {
        console.error("Auth check error:", error);
        setIsReady(true);
        SplashScreen.hideAsync();
        return () => {};
      }
    };

    checkAuthAndOnboarding();
  }, [isCompleted, onboardingLoading, data?.userData?.userType, segments]);

  if (!isReady || onboardingLoading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  return <Slot />;
}

// Main layout that provides the context
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
