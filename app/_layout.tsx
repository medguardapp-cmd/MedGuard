// app/_layout.tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { Slot, SplashScreen, useRouter, useSegments } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
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

  // ─── Auth + onboarding + caregiver check ──────────────────
  useEffect(() => {
    const checkAuthAndOnboarding = async () => {
      try {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
          await new Promise((resolve) => setTimeout(resolve, 500));

          const currentRoute = segments[0];

          if (user) {
            if (user.emailVerified) {
              // 1. Check AsyncStorage first (fast)
              let onboardingCompleted = await AsyncStorage.getItem(
                `${ONBOARDING_COMPLETED_KEY}_${user.uid}`,
              );

              let userType: string | null = null;
              let hasPatients = true; // Default to true for patients

              // Get user data from Firestore
              try {
                const userDoc = await getDoc(doc(db, "users", user.uid));
                if (userDoc.exists()) {
                  const data = userDoc.data();
                  userType = data?.userType || "patient";

                  // Check if onboarding is completed
                  const hasCompleted =
                    data?.onboardingCompleted === true ||
                    (data?.userData?.name &&
                      data.userData.name.trim().length > 0);

                  if (hasCompleted && onboardingCompleted !== "true") {
                    await AsyncStorage.setItem(
                      `${ONBOARDING_COMPLETED_KEY}_${user.uid}`,
                      "true",
                    );
                    onboardingCompleted = "true";
                    console.log("✅ Onboarding synced from Firestore");
                  }
                } else {
                  // User document doesn't exist yet - they need onboarding
                  onboardingCompleted = "false";
                  userType = "patient";
                }
              } catch (e) {
                console.warn("Could not check Firestore:", e);
              }

              // Check if caregiver has patients (only if userType is caregiver)
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
              } else {
                // Patients always have hasPatients = true (they don't need this check)
                hasPatients = true;
              }

              console.log("📋 Onboarding completed:", onboardingCompleted);
              console.log("👤 User type:", userType);
              console.log("👥 Has patients:", hasPatients);
              console.log("📍 Current route:", currentRoute);

              // ─── ROUTING LOGIC ────────────────────────────────
              if (onboardingCompleted === "true") {
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
  }, []);

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
