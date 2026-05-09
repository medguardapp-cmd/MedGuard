// app/_layout.tsx
import { NotificationProvider } from "@/contexts/NotificationContext";
import { SelectedPatientProvider } from "@/contexts/SelectedPatientContext";
import { Slot, SplashScreen, useRouter, useSegments } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
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
  getReminderLogIdWithTime,
  listenForAlarmActions,
} from "../services/reminderAlarmService";

// ✅ Import persistent alarm service
import { rescheduleAllAlarms } from "../services/persistentAlarmService";

SplashScreen.preventAutoHideAsync();

interface ReminderDoc {
  id: string;
  medicationId: string;
  medicationName: string;
  medicationDosage: string;
  [key: string]: any;
}

function RootLayoutNav() {
  const router = useRouter();
  const segments = useSegments();
  const { isCompleted, isLoading: onboardingLoading, data } = useOnboarding();

  const [isReady, setIsReady] = useState(false);
  const listenerSetup = useRef(false);
  const authUnsubscribeRef = useRef<any>(null);

  // ✅ Native alarm action listener (replaces expo-notifications response handler)
  useEffect(() => {
    if (listenerSetup.current) return;
    listenerSetup.current = true;

    const setup = async () => {
      await registerForPushNotificationsAsync();
    };
    setup();

    const sub = listenForAlarmActions(
      // ─── TAKE ───────────────────────────────────────────────
      async (reminderId: string) => {
        const userId = auth.currentUser?.uid;
        if (!userId || !reminderId) return;

        const currentDateKey = new Date().toDateString();

        try {
          const remindersSnap = await getDocs(
            collection(db, "users", userId, "reminders"),
          );

          const reminder = remindersSnap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as ReminderDoc)
            .find(
              (r) => r.id === reminderId || r.id === reminderId.split("_")[0],
            );

          if (!reminder) {
            console.warn("Reminder not found for id:", reminderId);
            return;
          }

          // Extract time from alarmId e.g. "abc123_Mon_08:00" → "08:00"
          const timePart = reminderId.split("_").find((p) => p.includes(":"));
          const scheduledTime = timePart || "08:00";

          const reminderName = reminder.medicationName || "Medication";
          const reminderDosage = reminder.medicationDosage || "";
          const reminderMedicationId = reminder.medicationId;

          // Save to taken_logs
          await addDoc(collection(db, "users", userId, "taken_logs"), {
            medicationId: reminderMedicationId,
            reminderId,
            name: reminderName,
            dosage: reminderDosage,
            takenAt: serverTimestamp(),
            dateKey: currentDateKey,
          });

          // Save to reminder_status_logs
          const statusLogId = getReminderLogIdWithTime(
            reminderId,
            scheduledTime,
            currentDateKey,
          );

          await setDoc(
            doc(db, "users", userId, "reminder_status_logs", statusLogId),
            {
              reminderId,
              medicationId: reminderMedicationId,
              name: reminderName,
              dosage: reminderDosage,
              scheduledTime,
              dateKey: currentDateKey,
              status: "taken",
              takenAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            },
          );

          await cancelMedicationAlarm(reminderId);
          console.log("✅ Marked as taken:", reminderName);
        } catch (error) {
          console.error("Error marking as taken:", error);
        }
      },

      // ─── SNOOZE ─────────────────────────────────────────────
      (reminderId: string) => {
        console.log("⏰ Snoozed:", reminderId);
      },

      // ─── SKIP ───────────────────────────────────────────────
      async (reminderId: string) => {
        await cancelMedicationAlarm(reminderId);
        console.log("❌ Skipped:", reminderId);
      },
    );

    return () => sub.remove();
  }, []);

  // ✅ Reschedule all persistent alarms when user is authenticated
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          console.log("🔄 Rescheduling all persistent alarms...");
          await rescheduleAllAlarms();
          console.log("✅ All alarms rescheduled successfully");
        } catch (error) {
          console.error("❌ Error rescheduling alarms:", error);
        }
      }
    });

    return () => unsubscribe();
  }, []);

  // ✅ Periodic rescheduling (every hour) to catch any missed schedules
  useEffect(() => {
    const interval = setInterval(
      async () => {
        if (auth.currentUser) {
          try {
            console.log("🔄 Periodic alarm reschedule check...");
            await rescheduleAllAlarms();
          } catch (error) {
            console.error("❌ Periodic reschedule error:", error);
          }
        }
      },
      60 * 60 * 1000,
    ); // Every hour

    return () => clearInterval(interval);
  }, []);

  // ─── Auth routing (unchanged) ──────────────────────────────
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
  }, [
    isCompleted,
    onboardingLoading,
    data?.userData?.userType,
    segments,
    router,
  ]);

  if (!isReady || onboardingLoading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  return <Slot />;
}

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
