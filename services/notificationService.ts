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

      if (diffMinutes >= 15 && diffMinutes < 60) {
        notifiedLateRef.current.add(key);
        addNotification({
          title: "⏰ Dose Late",
          message: `${reminder.medicationName} (${reminder.medicationDosage}) was scheduled for ${formatTime12h(time)}`,
          type: "warning",
          data: { reminderId: reminder.id, type: "late" },
          // ✅ No sendPush — late dose is low-priority; in-app only
        });
        continue;
      }

      if (diffMinutes >= 60) {
        notifiedMissedRef.current.add(key);
        addNotification({
          title: "❌ Dose Missed",
          message: `You missed ${reminder.medicationName} (${reminder.medicationDosage}) scheduled for ${formatTime12h(time)}`,
          type: "error",
          data: { reminderId: reminder.id, type: "missed" },
          sendPush: true, // ✅ missed dose → push if backgrounded
          channelId: "medications",
        });
      }
    }
  }
};

// 2. Check for consecutive missed days
export const checkConsecutiveMissedDays = async (
  reminders: any[],
  takenLogs: any[],
  addNotification: (n: any) => void,
  notifiedConsecutiveRef: React.MutableRefObject<Set<string>>,
) => {
  const THRESHOLD = 3;

  for (const reminder of reminders) {
    if (!reminder.enabled) continue;
    if (notifiedConsecutiveRef.current.has(reminder.id)) continue;

    let missedDays = 0;
    const now = new Date();

    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const dateKey = d.toDateString();
      const taken = takenLogs.some(
        (log) =>
          log.dateKey === dateKey &&
          (log.reminderId === reminder.id ||
            log.medicationId === reminder.medicationId),
      );
      if (!taken) missedDays++;
      else break;
    }

    if (missedDays >= THRESHOLD) {
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
        sendPush: true, // ✅ context decides whether to fire OS push
        channelId: "medications",
      });
      // ❌ Removed standalone sendLocalNotification — context handles it
    }
  }
};

// 3. Check for severe drug interactions
export const checkSevereInteractions = async (
  medications: any[],
  interactions: any[],
  addNotification: (n: any) => void,
  notifiedInteractionsRef: React.MutableRefObject<Set<string>>,
) => {
  for (const interaction of interactions) {
    if (getInteractionSeverity(interaction.description) !== "severe") continue;

    const key = `${interaction.drug_id}_${interaction.interacts_with}`;
    if (notifiedInteractionsRef.current.has(key)) continue;

    notifiedInteractionsRef.current.add(key);
    const med1 = medications.find((m) => m.drug_id === interaction.drug_id);
    const med2 = medications.find(
      (m) => m.drug_id === interaction.interacts_with,
    );

    addNotification({
      title: "⚠️ Severe Drug Interaction",
      message: `${med1?.name ?? interaction.drug_id} may interact severely with ${med2?.name ?? interaction.interacts_with}. Consult your doctor.`,
      type: "error",
      data: {
        type: "severe-interaction",
        drug1: interaction.drug_id,
        drug2: interaction.interacts_with,
        description: interaction.description,
      },
      sendPush: true,
      channelId: "interactions",
    });
  }
};

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
        ...d.data(),
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
          const isTaken = takenLogs.some(
            (log) =>
              log.reminderId === reminder.id ||
              log.reminderId === `${reminder.id}_${time}`,
          );
          const missedKey = `${patient.id}_${reminder.id}_${time}_${todayKey}`;

          if (isTaken || caregiverNotifiedMissedRef.current.has(missedKey))
            continue;

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
              sendPush: true,
              channelId: "medications",
            });
          }
        }
      }
    } catch (error) {
      console.error(`Error checking patient ${patient.id}:`, error);
    }
  }
};
