// app/_layout.tsx
import { NotificationProvider } from "@/contexts/NotificationContext";
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
  where,
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
      await setupNotificationCategories(); // ✅ Add this line
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

    // ✅ UPDATED: Handle notification responses with action buttons
    notificationResponseSub.current =
      Notifications.addNotificationResponseReceivedListener(
        async (response) => {
          const data = response.notification.request.content.data ?? {};
          const { reminderId, medicationName, dosage } = data;

          await handleNotificationResponse(
            response,
            // TAKE action - mark medication as taken
            async (id) => {
              const userId = auth.currentUser?.uid;
              if (userId && id) {
                const dk = new Date().toDateString();
                try {
                  // Extract the base reminder ID (remove time suffix)
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
            // SNOOZE action - schedule snooze for 10 minutes
            async (id) => {
              console.log("⏰ Snoozing reminder:", id);
              await scheduleSnoozeAlarm(
                id,
                medicationName || "Medication",
                dosage || "",
                10,
              );
            },
            // SKIP action - cancel the alarm
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
              // Wait for onboarding context to load
              if (onboardingLoading) {
                console.log("⏳ Waiting for onboarding context to load...");
                return;
              }

              console.log("📋 Onboarding completed from context:", isCompleted);
              console.log("👤 User type:", data?.userData?.userType);
              console.log("📍 Current route:", currentRoute);

              // Get user type from context
              const userType = data?.userData?.userType || "patient";

              // Check if caregiver has patients
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

              // ─── ROUTING LOGIC ────────────────────────────────
              if (isCompleted === true) {
                // ONLY caregivers with NO patients go to caregiver-only layout
                if (userType === "caregiver" && hasPatients === false) {
                  console.log(
                    "🔒 Caregiver with 0 patients - redirecting to caregiver-only layout",
                  );
                  if (currentRoute !== "(caregiver-only)") {
                    router.replace("/(caregiver-only)/connect");
                  }
                }
                // ALL OTHER users (patients AND caregivers with patients) go to main tabs
                else {
                  console.log(
                    "✅ User has access to main app - redirecting to tabs",
                  );
                  if (currentRoute !== "(tabs)") {
                    router.replace("/(tabs)");
                  }
                }
              }
              // Not onboarded yet
              else {
                console.log("📝 User not onboarded - redirecting to stepper");
                if (currentRoute !== "(onboarding)") {
                  router.replace("/(onboarding)/stepper");
                }
              }
            }
            // Email not verified
            else {
              console.log(
                "📧 Email not verified - redirecting to verify-email",
              );
              if (currentRoute !== "(auth)") {
                router.replace("/(auth)/verify-email");
              }
            }
          }
          // Not logged in
          else {
            console.log("🚪 Not logged in - redirecting to onboarding");
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
  }, [isCompleted, onboardingLoading, data?.userData?.userType]);

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
        <RootLayoutNav />
      </NotificationProvider>
    </OnboardingProvider>
  );
}
