// services/notificationService.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { collection, getDocs, query, where } from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { emailNotifications } from "./emailService";

const formatTime12h = (time: string) => {
  const [hours, minutes] = time.split(":");
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
};

// Returns a human-readable elapsed string, e.g. "1h 5m ago" or "45m ago"
const formatElapsed = (diffMinutes: number): string => {
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const h = Math.floor(diffMinutes / 60);
  const m = diffMinutes % 60;
  return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`;
};

const getInteractionSeverity = (description: string): "mild" | "severe" => {
  const lower = description?.toLowerCase() || "";
  const severeKeywords = [
    "severe",
    "serious",
    "fatal",
    "life-threatening",
    "major",
    "contraindicated",
    "avoid",
    "dangerous",
    "hemorrhage",
    "bleeding",
  ];
  return severeKeywords.some((k) => lower.includes(k)) ? "severe" : "mild";
};

// Add this helper function for safe user ID retrieval
const getUserIdSafely = (): string | null => {
  try {
    return auth.currentUser?.uid || null;
  } catch (error) {
    console.error("Error getting current user:", error);
    return null;
  }
};

// Add this wrapper for safe email notifications
const safeEmailNotification = async (
  emailFunctionName: string,
  ...args: any[]
) => {
  try {
    // Check if last arg is an options object with a userId override
    const lastArg = args[args.length - 1];
    let userId: string | null = null;

    if (lastArg && typeof lastArg === "object" && lastArg._userId) {
      userId = lastArg._userId;
      args = args.slice(0, -1); // Remove the options object
    } else {
      userId = getUserIdSafely();
    }

    if (!userId) {
      console.log("No authenticated user, skipping email notification");
      return;
    }

    // Check if emailNotifications exists
    if (!emailNotifications) {
      console.log("Email notifications service not initialized");
      return;
    }

    // Get the function from emailNotifications
    const emailFunction = (emailNotifications as any)[emailFunctionName];

    // Check if the function exists
    if (typeof emailFunction !== "function") {
      console.log(
        `Email function '${emailFunctionName}' not found in email service. Skipping email.`,
      );
      return;
    }

    await emailFunction(userId, ...args);
  } catch (error: any) {
    // Only log errors that aren't "not-found" (missing user profile)
    if (error?.code === "not-found" || error?.message?.includes("not-found")) {
      console.log(
        "User profile not found in Firestore. Email notifications will work once profile is set up.",
      );
    } else if (error?.code === "permission-denied") {
      console.log(
        "Permission denied for email notification. Check Firestore rules.",
      );
    } else {
      console.error("Email notification error:", error);
    }
  }
};

// Restore notified refs from storage
export const restoreNotifiedRefs = async (
  notifiedLateRef: React.RefObject<Set<string>>,
  notifiedMissedRef: React.RefObject<Set<string>>,
) => {
  const [lateRaw, missedRaw] = await Promise.all([
    AsyncStorage.getItem("notified_late"),
    AsyncStorage.getItem("notified_missed"),
  ]);

  // Prune yesterday's keys so storage doesn't grow forever
  const today = new Date().toDateString();
  const pruneToToday = (keys: string[]) =>
    keys.filter((k) => k.endsWith(today));

  if (lateRaw) {
    const keys = pruneToToday(JSON.parse(lateRaw));
    notifiedLateRef.current = new Set(keys);
  }
  if (missedRaw) {
    const keys = pruneToToday(JSON.parse(missedRaw));
    notifiedMissedRef.current = new Set(keys);
  }
};
export const restoreNotifiedInteractions = async (
  notifiedInteractionsRef: React.RefObject<Set<string>>,
) => {
  const raw = await AsyncStorage.getItem("notified_interactions");
  if (raw) {
    const today = new Date().toDateString();
    // Prune keys not from today so new days always re-evaluate
    const keys: string[] = JSON.parse(raw).filter((k: string) =>
      k.endsWith(today),
    );
    notifiedInteractionsRef.current = new Set(keys);
  }
};

// 1. Check for late/missed doses
export const checkMissedAndLateDoses = async (
  reminders: any[],
  takenLogs: any[],
  addNotification: (n: any) => void,
  notifiedLateRef: React.RefObject<Set<string>>,
  notifiedMissedRef: React.RefObject<Set<string>>,
  isLogsReady: boolean,
) => {
  if (!isLogsReady) return;

  const today = new Date();
  const todayKey = today.toDateString();
  const todayTaken = takenLogs.filter((log) => log.dateKey === todayKey);

  for (const reminder of reminders) {
    if (!reminder.enabled) continue;

    for (const time of reminder.times ?? ["08:00"]) {
      const [hours, minutes] = time.split(":").map(Number);
      const scheduled = new Date();
      scheduled.setHours(hours, minutes, 0, 0);

      if (scheduled.toDateString() !== today.toDateString()) continue;
      if (scheduled > today) continue;

      const diffMinutes = Math.floor(
        (today.getTime() - scheduled.getTime()) / 60_000,
      );

      // Check taken
      const isTaken = todayTaken.some(
        (log) =>
          log.reminderId === reminder.id ||
          log.reminderId === `${reminder.id}_${time}`,
      );

      if (isTaken) continue;

      const key = `${reminder.id}_${time}_${todayKey}`;

      if (
        notifiedLateRef.current.has(key) ||
        notifiedMissedRef.current.has(key)
      )
        continue;

      // --- LATE: 15–60 min — in-app + push only, not high-risk enough for email ---
      if (diffMinutes >= 15 && diffMinutes < 60) {
        notifiedLateRef.current.add(key);
        AsyncStorage.setItem(
          "notified_late",
          JSON.stringify([...notifiedLateRef.current]),
        );

        addNotification({
          title: "⏰ Dose Late",
          message: `${reminder.medicationName} (${reminder.medicationDosage}) was scheduled for ${formatTime12h(time)} — ${formatElapsed(diffMinutes)}`,
          type: "warning",
          data: { reminderId: reminder.id, type: "late" },
          sendPush: true,
          channelId: "medications",
        });

        // No email — late doses are low-risk; push notification is sufficient
        continue;
      }

      // --- MISSED SOFT: 60–120 min — in-app + push only, not critical enough for email ---
      if (diffMinutes >= 60 && diffMinutes < 120) {
        notifiedMissedRef.current.add(key);
        AsyncStorage.setItem(
          "notified_missed",
          JSON.stringify([...notifiedMissedRef.current]),
        );

        addNotification({
          title: "❌ Dose Missed",
          message: `You missed ${reminder.medicationName} (${reminder.medicationDosage}) scheduled for ${formatTime12h(time)} — ${formatElapsed(diffMinutes)}`,
          type: "error",
          data: {
            reminderId: reminder.id,
            type: "missed",
            missedKind: "soft",
            medicationName: reminder.medicationName,
            dosage: reminder.medicationDosage,
            scheduledTime: formatTime12h(time),
            elapsedMinutes: diffMinutes,
          },
          sendPush: true,
          channelId: "medications",
        });

        // No email — soft missed doses are moderate risk; push notification is sufficient
        continue;
      }

      // --- MISSED HARD: 120+ min — HIGH RISK, send email ---
      if (diffMinutes >= 120) {
        notifiedMissedRef.current.add(key);
        AsyncStorage.setItem(
          "notified_missed",
          JSON.stringify([...notifiedMissedRef.current]),
        );

        addNotification({
          title: "🚨 Dose Missed (Critical)",
          message: `You missed ${reminder.medicationName} (${reminder.medicationDosage}) scheduled for ${formatTime12h(time)} — ${formatElapsed(diffMinutes)}`,
          type: "error",
          data: {
            reminderId: reminder.id,
            type: "missed",
            missedKind: "hard",
            medicationName: reminder.medicationName,
            dosage: reminder.medicationDosage,
            scheduledTime: formatTime12h(time),
            elapsedMinutes: diffMinutes,
          },
          sendPush: true,
          channelId: "medication-alarms",
        });

        // Email — critical missed dose (120+ min) is high-risk
        await safeEmailNotification(
          "sendMissedDose",
          reminder.medicationName,
          reminder.medicationDosage,
          formatTime12h(time),
        );
      }
    }
  }
};

// 2. Check for consecutive missed days (threshold: 2 per spec)
export const checkConsecutiveMissedDays = async (
  reminders: any[],
  takenLogs: any[],
  addNotification: (n: any) => void,
  notifiedConsecutiveRef: React.RefObject<Set<string>>,
) => {
  const THRESHOLD = 2;

  for (const reminder of reminders) {
    if (!reminder.enabled) continue;
    if (notifiedConsecutiveRef.current.has(reminder.id)) continue;

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    let createdAt: Date | null = null;
    if (reminder.createdAt) {
      if (reminder.createdAt.seconds) {
        createdAt = new Date(reminder.createdAt.seconds * 1000);
      } else if (reminder.createdAt.toDate) {
        createdAt = reminder.createdAt.toDate();
      } else {
        createdAt = new Date(reminder.createdAt);
      }
    }

    if (!createdAt) {
      console.log(`Skipping ${reminder.medicationName} - no createdAt`);
      continue;
    }

    const createdDayStart = new Date(createdAt);
    createdDayStart.setHours(0, 0, 0, 0);

    const daysSinceCreation = Math.floor(
      (todayStart.getTime() - createdDayStart.getTime()) /
        (1000 * 60 * 60 * 24),
    );

    if (daysSinceCreation < THRESHOLD) {
      console.log(
        `Skipping ${reminder.medicationName} - too new (${daysSinceCreation} days)`,
      );
      continue;
    }

    let missedDays = 0;
    const maxDaysToCheck = Math.min(7, daysSinceCreation);

    for (let i = 1; i <= maxDaysToCheck; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);

      const dayStart = new Date(d);
      dayStart.setHours(0, 0, 0, 0);

      if (dayStart < createdDayStart) break;

      const dateKey = d.toDateString();
      const taken = takenLogs.some(
        (log) =>
          log.dateKey === dateKey &&
          (log.reminderId === reminder.id ||
            log.medicationId === reminder.medicationId),
      );

      if (!taken) {
        missedDays++;
      } else {
        break;
      }
    }

    if (missedDays >= THRESHOLD) {
      notifiedConsecutiveRef.current.add(reminder.id);
      addNotification({
        title: "⚠️ Low Medication Adherence",
        message: `You haven't taken ${reminder.medicationName} for ${missedDays} consecutive day${missedDays > 1 ? "s" : ""}.`,
        type: "error",
        data: {
          reminderId: reminder.id,
          type: "consecutive-missed",
          days: missedDays,
          medicationName: reminder.medicationName,
        },
        sendPush: true,
        channelId: "medications",
      });

      // Email — consecutive missed days is a high-risk adherence pattern
      await safeEmailNotification(
        "sendLowAdherence",
        reminder.medicationName,
        missedDays,
      );
    }
  }
};

// 3. Check for drug interactions — both mild AND severe per spec
export const checkInteractions = async (
  medications: any[],
  interactions: any[],
  addNotification: (n: any) => void,
  notifiedInteractionsRef: React.RefObject<Set<string>>,
) => {
  for (const interaction of interactions) {
    const severity = getInteractionSeverity(interaction.description);

    if (severity !== "mild" && severity !== "severe") continue;

    // REPLACE with these 4 lines:
    const today = new Date().toDateString();
    const key = `${interaction.drug_id}_${interaction.interacts_with}_${today}`;
    if (notifiedInteractionsRef.current.has(key)) continue;
    notifiedInteractionsRef.current.add(key);

    // Persist after adding
    AsyncStorage.setItem(
      "notified_interactions",
      JSON.stringify([...notifiedInteractionsRef.current]),
    );

    const med1 = medications.find((m) => m.drug_id === interaction.drug_id);
    const med2 = medications.find(
      (m) => m.drug_id === interaction.interacts_with,
    );

    if (severity === "severe") {
      addNotification({
        title: "🚨 Severe Drug Interaction",
        message: `${med1?.name ?? interaction.drug_id} and ${med2?.name ?? interaction.interacts_with} have a severe interaction. ${interaction.description}. Contact your doctor immediately.`,
        type: "error",
        data: {
          type: "severe-interaction",
          severity: "severe",
          drug1: interaction.drug_id,
          drug2: interaction.interacts_with,
          description: interaction.description,
        },
        sendPush: true,
        channelId: "medication-alarms",
      });

      // Email — severe interactions are high-risk and require immediate attention
      await safeEmailNotification(
        "sendDrugInteraction",
        med1?.name ?? interaction.drug_id,
        med2?.name ?? interaction.interacts_with,
        interaction.description,
      );
    } else {
      // Mild interaction — in-app + push only, not severe enough for email
      addNotification({
        title: "⚠️ Drug Interaction Notice",
        message: `${med1?.name ?? interaction.drug_id} may have a mild interaction with ${med2?.name ?? interaction.interacts_with}. Monitor for side effects.`,
        type: "warning",
        data: {
          type: "mild-interaction",
          severity: "mild",
          drug1: interaction.drug_id,
          drug2: interaction.interacts_with,
          description: interaction.description,
        },
        sendPush: true,
        channelId: "interactions",
      });

      // No email — mild interactions are informational; push notification is sufficient
    }
  }
};

// Keep old export name as alias so existing callers don't break
export const checkSevereInteractions = checkInteractions;

// 4. Check for caregiver connection requests (for patients)
export const checkCaregiverRequests = async (
  userId: string,
  addNotification: (n: any) => void,
  notifiedRequestsRef: React.RefObject<Set<string>>,
) => {
  try {
    const snap = await getDocs(
      query(
        collection(db, "caregiver_requests"),
        where("patientId", "==", userId),
        where("status", "==", "pending"),
      ),
    );

    for (const doc of snap.docs) {
      if (notifiedRequestsRef.current.has(doc.id)) continue;
      notifiedRequestsRef.current.add(doc.id);
      const request = doc.data();

      addNotification({
        title: "👤 Caregiver Request",
        message: `${request.caregiverName} wants to connect as your caregiver.`,
        type: "info",
        data: {
          type: "caregiver-request",
          requestId: doc.id,
          caregiverId: request.caregiverId,
          caregiverName: request.caregiverName,
        },
        sendPush: true,
        channelId: "general",
      });

      // No email — caregiver requests are informational; push notification is sufficient
    }
  } catch (error) {
    console.error("Error checking caregiver requests:", error);
  }
};

// 5. Check patient missed doses (for caregivers)
export const checkCaregiverPatientMissedDoses = async (
  patients: { id: string; name: string }[],
  addNotification: (n: any) => void,
  caregiverNotifiedMissedRef: React.RefObject<Set<string>>,
) => {
  const today = new Date();
  const todayKey = today.toDateString();

  for (const patient of patients) {
    try {
      const [takenSnap, remindersSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, "users", patient.id, "taken_logs"),
            where("dateKey", "==", todayKey),
          ),
        ),
        getDocs(
          query(
            collection(db, "users", patient.id, "reminders"),
            where("enabled", "==", true),
          ),
        ),
      ]);

      const takenLogs = takenSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const reminders = remindersSnap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      }));

      for (const reminder of reminders) {
        for (const time of reminder.times ?? ["08:00"]) {
          const [hours, minutes] = time.split(":").map(Number);
          const scheduled = new Date();
          scheduled.setHours(hours, minutes, 0, 0);

          if (scheduled.toDateString() !== today.toDateString()) continue;
          if (scheduled > today) continue;

          const diffMinutes = Math.floor(
            (today.getTime() - scheduled.getTime()) / 60_000,
          );
          const isTaken = (takenLogs as any[]).some(
            (log) =>
              log.reminderId === reminder.id ||
              log.reminderId === `${reminder.id}_${time}`,
          );
          const missedKey = `${patient.id}_${reminder.id}_${time}_${todayKey}`;

          if (isTaken || caregiverNotifiedMissedRef.current.has(missedKey))
            continue;

          if (diffMinutes < 60) continue;

          caregiverNotifiedMissedRef.current.add(missedKey);
          addNotification({
            title: "⚠️ Patient Missed Dose",
            message: `${patient.name} missed ${reminder.medicationName} (${reminder.medicationDosage}) scheduled for ${formatTime12h(time)} — ${formatElapsed(diffMinutes)}`,
            type: "warning",
            data: {
              type: "patient-missed",
              patientId: patient.id,
              reminderId: reminder.id,
              patientName: patient.name,
              medicationName: reminder.medicationName,
              dosage: reminder.medicationDosage,
              scheduledTime: formatTime12h(time),
              elapsedMinutes: diffMinutes,
            },
            sendPush: true,
            channelId: "medications",
          });

          // Email — caregiver oversight of patient missed dose is high-risk
          await safeEmailNotification(
            "sendPatientMissed",
            patient.name,
            reminder.medicationName,
            reminder.medicationDosage,
            formatTime12h(time),
            { _userId: patient.id },
          );
        }
      }
    } catch (error) {
      console.error(`Error checking patient ${patient.id}:`, error);
    }
  }
};

// 6. Check interactions for medications taken today
export const checkTodaysMedicationInteractions = async (
  takenLogs: any[],
  medications: any[],
  interactions: any[],
  addNotification: (n: any) => void,
  notifiedInteractionsRef: React.RefObject<Set<string>>,
) => {
  const todayKey = new Date().toDateString();
  const todayTaken = takenLogs.filter((log) => log.dateKey === todayKey);

  if (todayTaken.length < 2) return;

  // Get medication IDs taken today
  const todayMedIds = new Set(
    todayTaken.map((log) => log.medicationId).filter(Boolean),
  );

  for (const interaction of interactions) {
    // Only flag if BOTH interacting drugs were taken today
    if (
      !todayMedIds.has(interaction.drug_id) ||
      !todayMedIds.has(interaction.interacts_with)
    )
      continue;

    const severity = getInteractionSeverity(interaction.description);

    const key = `today_${interaction.drug_id}_${interaction.interacts_with}_${todayKey}`;
    if (notifiedInteractionsRef.current.has(key)) continue;
    notifiedInteractionsRef.current.add(key);
    AsyncStorage.setItem(
      "notified_interactions",
      JSON.stringify([...notifiedInteractionsRef.current]),
    );
    const med1 = medications.find((m) => m.drug_id === interaction.drug_id);
    const med2 = medications.find(
      (m) => m.drug_id === interaction.interacts_with,
    );

    addNotification({
      title:
        severity === "severe"
          ? "🚨 Dangerous Interaction Today"
          : "⚠️ Interaction Notice Today",
      message: `You took ${med1?.name ?? interaction.drug_id} and ${med2?.name ?? interaction.interacts_with} today — these have a ${severity} interaction. ${severity === "severe" ? "Contact your doctor immediately." : "Monitor for side effects."}`,
      type: severity === "severe" ? "error" : "warning",
      data: {
        type: severity === "severe" ? "severe-interaction" : "mild-interaction",
        severity,
        drug1: interaction.drug_id,
        drug2: interaction.interacts_with,
        description: interaction.description,
        takenToday: true,
      },
      sendPush: true,
      channelId: severity === "severe" ? "medication-alarms" : "interactions",
    });

    if (severity === "severe") {
      // Email — severe interactions taken today require immediate action
      await safeEmailNotification(
        "sendDrugInteraction",
        med1?.name ?? interaction.drug_id,
        med2?.name ?? interaction.interacts_with,
        interaction.description,
      );
    }
  }
};
