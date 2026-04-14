// services/notificationService.ts
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../lib/firebase";
import { sendLocalNotification } from "../lib/notifications";

// Helper function
const formatTime12h = (time: string) => {
  const [hours, minutes] = time.split(":");
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
};

// Get interaction severity
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

// 1. Check for late/missed doses
export const checkMissedAndLateDoses = async (
  reminders: any[],
  takenLogs: any[],
  addNotification: (notification: any) => void,
  notifiedLateRef: React.MutableRefObject<Set<string>>,
  notifiedMissedRef: React.MutableRefObject<Set<string>>,
) => {
  const today = new Date();
  const todayKey = today.toDateString();
  const currentMinutes = today.getHours() * 60 + today.getMinutes();

  const todayTaken = takenLogs.filter((log) => log.dateKey === todayKey);

  for (const reminder of reminders) {
    if (!reminder.enabled) continue;

    for (const time of reminder.times || ["08:00"]) {
      const [hours, minutes] = time.split(":").map(Number);

      const scheduledDateTime = new Date();
      scheduledDateTime.setHours(hours, minutes, 0, 0);

      const now = new Date();
      const isToday = scheduledDateTime.toDateString() === now.toDateString();

      if (!isToday) continue;

      // 🚫 Ignore if scheduled time is in the future
      if (scheduledDateTime > now) continue;

      const diffMinutes = Math.floor(
        (now.getTime() - scheduledDateTime.getTime()) / 60000,
      );

      // Only check TODAY logs
      const isTaken = todayTaken.some(
        (log) =>
          log.reminderId === reminder.id ||
          log.reminderId === `${reminder.id}_${time}`,
      );

      if (isTaken) continue;

      const key = `${reminder.id}_${time}_${todayKey}`;

      // 🚫 Prevent duplicate notifications per day
      if (
        notifiedLateRef.current.has(key) ||
        notifiedMissedRef.current.has(key)
      ) {
        continue;
      }

      // ✅ Late (15–59 min)
      if (diffMinutes >= 15 && diffMinutes < 60) {
        notifiedLateRef.current.add(key);

        addNotification({
          title: "⏰ Dose Late",
          message: `${reminder.medicationName} (${reminder.medicationDosage}) was scheduled for ${formatTime12h(time)}`,
          type: "warning",
          data: { reminderId: reminder.id, type: "late" },
        });

        continue;
      }

      // ✅ Missed (60+ min ONLY TODAY)
      if (diffMinutes >= 60) {
        notifiedMissedRef.current.add(key);

        addNotification({
          title: "❌ Dose Missed",
          message: `You missed ${reminder.medicationName} (${reminder.medicationDosage}) scheduled for ${formatTime12h(time)}`,
          type: "error",
          data: { reminderId: reminder.id, type: "missed" },
        });
      }
    }
  }
};

// 2. Check for consecutive missed days (3+ days)
export const checkConsecutiveMissedDays = async (
  reminders: any[],
  takenLogs: any[],
  addNotification: (notification: any) => void,
  notifiedConsecutiveRef: React.MutableRefObject<Set<string>>,
) => {
  const CONSECUTIVE_DAYS_THRESHOLD = 3;

  for (const reminder of reminders) {
    if (!reminder.enabled) continue;

    let missedDays = 0;
    let currentDate = new Date();

    // Check last 7 days
    for (let i = 0; i < 7; i++) {
      const checkDate = new Date(currentDate);
      checkDate.setDate(currentDate.getDate() - i);
      const dateKey = checkDate.toDateString();

      const wasTaken = takenLogs.some(
        (log) =>
          log.dateKey === dateKey &&
          (log.reminderId === reminder.id ||
            log.medicationId === reminder.medicationId),
      );

      if (!wasTaken) {
        missedDays++;
      } else {
        break; // Break streak
      }
    }

    // Notify if missed for X consecutive days
    if (
      missedDays >= CONSECUTIVE_DAYS_THRESHOLD &&
      !notifiedConsecutiveRef.current.has(reminder.id)
    ) {
      notifiedConsecutiveRef.current.add(reminder.id);
      addNotification({
        title: "⚠️ Medication Adherence Alert",
        message: `You've missed ${reminder.medicationName} for ${missedDays} consecutive days. This may affect your treatment.`,
        type: "error",
        data: {
          reminderId: reminder.id,
          type: "consecutive-missed",
          days: missedDays,
        },
      });
      await sendLocalNotification(
        "⚠️ Medication Adherence Alert",
        `You've missed ${reminder.medicationName} for ${missedDays} days. Please take your medication as prescribed.`,
        { reminderId: reminder.id, type: "consecutive-missed" },
      );
    }
  }
};

// 3. Check for severe medication interactions
export const checkSevereInteractions = async (
  medications: any[],
  interactions: any[],
  addNotification: (notification: any) => void,
  notifiedInteractionsRef: React.MutableRefObject<Set<string>>,
) => {
  for (const interaction of interactions) {
    const severity = getInteractionSeverity(interaction.description);
    if (severity === "severe") {
      const med1 = medications.find((m) => m.drug_id === interaction.drug_id);
      const med2 = medications.find(
        (m) => m.drug_id === interaction.interacts_with,
      );
      const key = `${interaction.drug_id}_${interaction.interacts_with}`;

      if (!notifiedInteractionsRef.current.has(key)) {
        notifiedInteractionsRef.current.add(key);
        addNotification({
          title: "⚠️ Severe Drug Interaction",
          message: `${med1?.name || interaction.drug_id} may interact severely with ${med2?.name || interaction.interacts_with}. Consult your doctor.`,
          type: "error",
          data: {
            type: "severe-interaction",
            drug1: interaction.drug_id,
            drug2: interaction.interacts_with,
            description: interaction.description,
          },
        });
        await sendLocalNotification(
          "⚠️ Severe Drug Interaction Alert",
          `Potential severe interaction between your medications. Please check the Reactions tab.`,
          { type: "severe-interaction" },
          "interactions",
        );
      }
    }
  }
};

// 4. Check for caregiver connection requests (for patients)
export const checkCaregiverRequests = async (
  userId: string,
  addNotification: (notification: any) => void,
  notifiedRequestsRef: React.MutableRefObject<Set<string>>,
) => {
  try {
    const requestsQuery = query(
      collection(db, "caregiver_requests"),
      where("patientId", "==", userId),
      where("status", "==", "pending"),
    );

    const snapshot = await getDocs(requestsQuery);

    for (const doc of snapshot.docs) {
      const request = doc.data();
      const requestId = doc.id;

      if (!notifiedRequestsRef.current.has(requestId)) {
        notifiedRequestsRef.current.add(requestId);
        addNotification({
          title: "👤 Caregiver Request",
          message: `${request.caregiverName} wants to connect as your caregiver.`,
          type: "info",
          data: {
            type: "caregiver-request",
            requestId,
            caregiverId: request.caregiverId,
          },
        });
        await sendLocalNotification(
          "👤 Caregiver Connection Request",
          `${request.caregiverName} wants to help manage your medications.`,
          { type: "caregiver-request", requestId },
        );
      }
    }
  } catch (error) {
    console.error("Error checking caregiver requests:", error);
  }
};

// 5. Check for caregiver's patient missed doses (for caregivers)
export const checkCaregiverPatientMissedDoses = async (
  patients: { id: string; name: string }[],
  addNotification: (notification: any) => void,
  caregiverNotifiedMissedRef: React.MutableRefObject<Set<string>>,
) => {
  const today = new Date();
  const todayKey = today.toDateString();
  const currentMinutes = today.getHours() * 60 + today.getMinutes();

  for (const patient of patients) {
    try {
      // Get patient's taken logs for today
      const takenLogsQuery = query(
        collection(db, "users", patient.id, "taken_logs"),
        where("dateKey", "==", todayKey),
      );
      const takenSnapshot = await getDocs(takenLogsQuery);
      const takenLogs = takenSnapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      // Get patient's reminders
      const remindersQuery = query(
        collection(db, "users", patient.id, "reminders"),
        where("enabled", "==", true),
      );
      const remindersSnapshot = await getDocs(remindersQuery);
      const reminders = remindersSnapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      for (const reminder of reminders) {
        for (const time of reminder.times || ["08:00"]) {
          const [hours, minutes] = time.split(":").map(Number);
          const scheduledDateTime = new Date();
          scheduledDateTime.setHours(hours, minutes, 0, 0);

          const now = new Date();
          const isToday =
            scheduledDateTime.toDateString() === now.toDateString();

          if (!isToday) continue;
          if (scheduledDateTime > now) continue;

          const diffMinutes = Math.floor(
            (now.getTime() - scheduledDateTime.getTime()) / 60000,
          );

          const isTaken = takenLogs.some(
            (log) =>
              log.reminderId === reminder.id ||
              log.reminderId === `${reminder.id}_${time}`,
          );

          const missedKey = `${patient.id}_${reminder.id}_${time}_${todayKey}`;

          // Notify caregiver if patient missed dose (60+ minutes late)
          if (isTaken) continue;

          // 🚫 prevent duplicate per day
          if (caregiverNotifiedMissedRef.current.has(missedKey)) continue;

          // ✅ missed today only
          if (diffMinutes >= 60) {
            caregiverNotifiedMissedRef.current.add(missedKey);
            addNotification({
              title: "⚠️ Patient Missed Dose",
              message: `${patient.name} missed ${reminder.medicationName} (${reminder.medicationDosage}) scheduled for ${formatTime12h(time)}`,
              type: "warning",
              data: {
                type: "patient-missed",
                patientId: patient.id,
                reminderId: reminder.id,
              },
            });
            await sendLocalNotification(
              "⚠️ Patient Missed Medication",
              `${patient.name} missed their ${reminder.medicationName} dose.`,
              { type: "patient-missed", patientId: patient.id },
            );
          }
        }
      }
    } catch (error) {
      console.error(`Error checking patient ${patient.id}:`, error);
    }
  }
};
