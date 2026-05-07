// services/notificationService.ts
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../lib/firebase";

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

// 1. Check for late/missed doses
export const checkMissedAndLateDoses = async (
  reminders: any[],
  takenLogs: any[],
  addNotification: (n: any) => void,
  notifiedLateRef: React.MutableRefObject<Set<string>>,
  notifiedMissedRef: React.MutableRefObject<Set<string>>,
) => {
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

      // --- LATE: 15–60 min ---
      if (diffMinutes >= 15 && diffMinutes < 60) {
        notifiedLateRef.current.add(key);
        addNotification({
          title: "⏰ Dose Late",
          message: `${reminder.medicationName} (${reminder.medicationDosage}) was scheduled for ${formatTime12h(time)} — ${formatElapsed(diffMinutes)}`,
          type: "warning",
          data: { reminderId: reminder.id, type: "late" },
          sendPush: true, // ✅ push + in-app per spec
          channelId: "medications",
        });
        continue;
      }

      // --- MISSED SOFT: 60–120 min ---
      if (diffMinutes >= 60 && diffMinutes < 120) {
        notifiedMissedRef.current.add(key);
        addNotification({
          title: "❌ Dose Missed",
          message: `You missed ${reminder.medicationName} (${reminder.medicationDosage}) scheduled for ${formatTime12h(time)} — ${formatElapsed(diffMinutes)}`,
          type: "error",
          data: {
            reminderId: reminder.id,
            type: "missed",
            missedKind: "soft", // ✅ soft missed
            medicationName: reminder.medicationName,
            dosage: reminder.medicationDosage,
            scheduledTime: formatTime12h(time),
            elapsedMinutes: diffMinutes,
          },
          sendPush: true,
          channelId: "medications",
        });
        continue;
      }

      // --- MISSED HARD: 120+ min ---
      if (diffMinutes >= 120) {
        notifiedMissedRef.current.add(key);
        addNotification({
          title: "🚨 Dose Missed (Critical)",
          message: `You missed ${reminder.medicationName} (${reminder.medicationDosage}) scheduled for ${formatTime12h(time)} — ${formatElapsed(diffMinutes)}`,
          type: "error",
          data: {
            reminderId: reminder.id,
            type: "missed",
            missedKind: "hard", // ✅ hard missed
            medicationName: reminder.medicationName,
            dosage: reminder.medicationDosage,
            scheduledTime: formatTime12h(time),
            elapsedMinutes: diffMinutes,
          },
          sendPush: true,
          channelId: "medication-alarms", // ✅ high-priority channel for hard miss
        });
      }
    }
  }
};

// 2. Check for consecutive missed days (threshold: 2 per spec)
export const checkConsecutiveMissedDays = async (
  reminders: any[],
  takenLogs: any[],
  addNotification: (n: any) => void,
  notifiedConsecutiveRef: React.MutableRefObject<Set<string>>,
) => {
  const THRESHOLD = 2; // ✅ Fixed: spec says 2+ consecutive days

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

    // ✅ Need at least THRESHOLD days of history
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
    }
  }
};

// 3. Check for drug interactions — both mild AND severe per spec
export const checkInteractions = async (
  medications: any[],
  interactions: any[],
  addNotification: (n: any) => void,
  notifiedInteractionsRef: React.MutableRefObject<Set<string>>,
) => {
  for (const interaction of interactions) {
    const severity = getInteractionSeverity(interaction.description);

    // ✅ Fixed: was only "severe"; spec requires mild too
    if (severity !== "mild" && severity !== "severe") continue;

    const key = `${interaction.drug_id}_${interaction.interacts_with}`;
    if (notifiedInteractionsRef.current.has(key)) continue;

    notifiedInteractionsRef.current.add(key);

    const med1 = medications.find((m) => m.drug_id === interaction.drug_id);
    const med2 = medications.find(
      (m) => m.drug_id === interaction.interacts_with,
    );

    if (severity === "severe") {
      addNotification({
        title: "🚨 Severe Drug Interaction",
        message: `${med1?.name ?? interaction.drug_id} may interact severely with ${med2?.name ?? interaction.interacts_with}. Consult your doctor immediately.`,
        type: "error",
        data: {
          type: "severe-interaction",
          severity: "severe",
          drug1: interaction.drug_id,
          drug2: interaction.interacts_with,
          description: interaction.description,
        },
        sendPush: true,
        channelId: "interactions",
      });
    } else {
      // ✅ Mild interaction — in-app + push per spec
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
        sendPush: true, // ✅ push + in-app per spec
        channelId: "interactions",
      });
    }
  }
};

// Keep old export name as alias so existing callers don't break
export const checkSevereInteractions = checkInteractions;

// 4. Check for caregiver connection requests (for patients)
export const checkCaregiverRequests = async (
  userId: string,
  addNotification: (n: any) => void,
  notifiedRequestsRef: React.MutableRefObject<Set<string>>,
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
    }
  } catch (error) {
    console.error("Error checking caregiver requests:", error);
  }
};

// 5. Check patient missed doses (for caregivers)
export const checkCaregiverPatientMissedDoses = async (
  patients: { id: string; name: string }[],
  addNotification: (n: any) => void,
  caregiverNotifiedMissedRef: React.MutableRefObject<Set<string>>,
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

          if (diffMinutes < 60) continue; // Only notify caregiver on actual missed (60+ min)

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
        }
      }
    } catch (error) {
      console.error(`Error checking patient ${patient.id}:`, error);
    }
  }
};
