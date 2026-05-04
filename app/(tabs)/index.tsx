// app/(tabs)/index.tsx
import { NotificationBell } from "@/components/NotificationBell";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import Colors from "../../constants/colors";
import { useNotifications } from "../../contexts/NotificationContext";
import { useSelectedPatient } from "../../contexts/SelectedPatientContext";
import { useCaregiverPermissions } from "../../hooks/useCaregiverPermissions";
import { auth, db } from "../../lib/firebase";
import {
  checkAllInteractions,
  MedicineSearchResult,
  searchMedicines,
} from "../../lib/supabase";
import { tabEvents } from "../../lib/tabEvents";
import {
  checkCaregiverPatientMissedDoses,
  checkCaregiverRequests,
  checkConsecutiveMissedDays,
  checkMissedAndLateDoses,
  checkSevereInteractions,
} from "../../services/notificationService";

import {
  cancelMedicationAlarm,
  scheduleMedicationAlarm,
} from "../../services/reminderAlarmService";

const originalConsoleLog = console.log;
console.log = (...args) => {
  // Skip the markAsTaken check logs
  if (
    args[0] &&
    typeof args[0] === "string" &&
    args[0].includes("markAsTaken check")
  ) {
    return;
  }
  originalConsoleLog(...args);
};
const DAY_WIDTH = 50;

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
interface Medication {
  id: string;
  drug_id: string;
  drug_ids: string[];
  name: string;
  generic_name: string;
  dosageAmount?: number; // ✅ Add
  dosageUnit?: string;
  active: boolean;
  is_combination: boolean;
  ingredients: string[];
  quantity?: number;
}

interface Reminder {
  id: string;
  medicationId: string;
  medicationName: string;
  medicationDosage: string;
  times: string[];
  days: string[];
  enabled: boolean;

  durationType?: "none" | "date-range" | "until-empty";
  startDate?: string | null;
  endDate?: string | null;

  scheduledDate?: any; // ADD THIS
  createdAt?: any;
}

interface ScheduleItem {
  reminderId: string;
  medicationId: string;
  name: string;
  dosageAmount?: number;
  dosageUnit?: string;
  time: string;
  actualTakenTime?: string | null;
  taken: boolean;
  missed: boolean;
  missedSoft: boolean;
  takenLogId?: string;
  takenVariance: "early" | "late" | "on-time" | null;
  hasInteraction: boolean;
  interactionSeverity: "mild" | "severe" | null;
  interactionCount: number;
  late: boolean;
}

interface InteractionInfo {
  drug_id: string;
  interacts_with: string;
  interacts_name: string;
  description: string;
}

interface TakenLog {
  id: string;
  medicationId: string;
  reminderId: string;
  name: string;
  dosageAmount?: number;
  dosageUnit?: string;
  takenAt: any;
  dateKey: string;
}

interface MissedLog {
  id: string;
  medicationId: string;
  reminderId: string;
  name: string;
  dosageAmount?: number;
  dosageUnit?: string;
  scheduledTime: string;
  dateKey: string;
  missedAt: any;
}
interface ReminderStatusLog {
  id: string;
  reminderId: string;
  medicationId: string;
  name: string;
  dosage: string;
  scheduledTime: string;
  dateKey: string;
  status: "not-taken" | "taken" | "late" | "missed";
  takenAt?: any;
  takenVariance?: "early" | "late" | "on-time" | null;
  updatedAt: any;
}
const getDosageDisplay = (medication: {
  dosage?: string;
  dosageAmount?: number;
  dosageUnit?: string;
}): string => {
  if (medication.dosage) return medication.dosage;
  if (medication.dosageAmount !== undefined) {
    const unit = medication.dosageUnit || "mg";
    return `${medication.dosageAmount} ${unit}`;
  }
  return "No dosage set";
};
// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LATE_THRESHOLD = 60; // minutes - after this time, show as "Late"
const SOFT_MISSED_THRESHOLD = 360;

const normalizeDate = (date: Date): Date => {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
};

function dateKey(date: Date): string {
  return date.toDateString();
}

/**
 * Returns a stable YYYY-MM-DD string used as a Firestore doc ID
 * for the "end-of-day missed" write — avoids duplicates across timezones.
 */
function isoDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const getOneTimeReminderDate = (reminder: Reminder): Date => {
  // If there's a stored scheduled date, use it
  if (reminder.scheduledDate) {
    return normalizeDate(
      reminder.scheduledDate?.toDate
        ? reminder.scheduledDate.toDate()
        : new Date(reminder.scheduledDate),
    );
  }

  // Fallback to creation date (backward compatibility)
  const baseDate = reminder.createdAt?.toDate
    ? reminder.createdAt.toDate()
    : new Date();

  let timeString = "08:00";
  if (reminder.times && reminder.times.length > 0) {
    timeString = reminder.times[0];
  }

  const [hours, minutes] = timeString.split(":").map(Number);
  const reminderTime = new Date(baseDate);
  reminderTime.setHours(hours, minutes, 0, 0);

  return normalizeDate(reminderTime);
};

const isReminderActiveOnDate = (
  reminder: Reminder,
  date: Date,
  medication?: Medication,
): boolean => {
  if (!reminder.enabled) return false;

  const normalizedDate = normalizeDate(date);

  // Handle one-time reminders (no days array or empty days array)
  if (!reminder.days || reminder.days.length === 0) {
    // ✅ Use scheduledDate if it exists
    if (reminder.scheduledDate) {
      const scheduledDate = normalizeDate(new Date(reminder.scheduledDate));
      return normalizedDate.getTime() === scheduledDate.getTime();
    }

    // ✅ Fallback: Calculate based on creation date
    const createdDate = reminder.createdAt?.toDate
      ? reminder.createdAt.toDate()
      : new Date(reminder.createdAt);

    const firstTime =
      reminder.times && reminder.times.length > 0 ? reminder.times[0] : "08:00";
    const [hours, minutes] = firstTime.split(":").map(Number);

    const reminderDateTime = new Date(createdDate);
    reminderDateTime.setHours(hours, minutes, 0, 0);

    // If time passed on creation day, move to next day
    if (reminderDateTime <= createdDate) {
      reminderDateTime.setDate(reminderDateTime.getDate() + 1);
    }

    const scheduledDate = normalizeDate(reminderDateTime);
    return normalizedDate.getTime() === scheduledDate.getTime();
  }

  // For recurring reminders with days
  const dayName = DAY_NAMES[normalizedDate.getDay()];
  if (!reminder.days.includes(dayName)) return false;

  // Check creation date for recurring reminders
  if (reminder.createdAt) {
    const createdDate = normalizeDate(
      reminder.createdAt?.toDate
        ? reminder.createdAt.toDate()
        : new Date(reminder.createdAt),
    );
    if (normalizedDate < createdDate) return false;
  }

  // Check date range for recurring reminders
  if (reminder.durationType === "date-range") {
    if (reminder.startDate) {
      const startDate = normalizeDate(new Date(reminder.startDate));
      if (normalizedDate < startDate) return false;
    }
    if (reminder.endDate) {
      const endDate = normalizeDate(new Date(reminder.endDate));
      if (normalizedDate > endDate) return false;
    }
  }

  // Check quantity for "until-empty" reminders
  if (reminder.durationType === "until-empty") {
    if (!medication || medication.quantity === undefined) return false;
    if (medication.quantity <= 0) return false;
  }

  return true;
};

const getRemindersForDate = (
  date: Date,
  allReminders: Reminder[],
  medications: Medication[],
): Reminder[] => {
  return allReminders.filter((reminder) => {
    const medication = medications.find((m) => m.id === reminder.medicationId);
    return isReminderActiveOnDate(reminder, date, medication);
  });
};

function getInteractionSeverity(description: string): "mild" | "severe" {
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
}

function formatTime12h(time: string) {
  const [hours, minutes] = time.split(":");
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
}

function getTakenVariance(
  scheduledTime: string,
  takenLog: TakenLog | undefined,
): "early" | "late" | "on-time" | null {
  if (!takenLog?.takenAt?.toDate) return null;
  const takenDate = takenLog.takenAt.toDate() as Date;
  const takenMinutes = takenDate.getHours() * 60 + takenDate.getMinutes();
  const [sh, sm] = scheduledTime.split(":").map(Number);
  const scheduledMinutes = sh * 60 + sm;
  const diff = takenMinutes - scheduledMinutes;
  if (diff > 60) return "late";
  if (diff < -60) return "early";
  return "on-time";
}

// ─────────────────────────────────────────────
// Save missed logs for a past date
// ─────────────────────────────────────────────
/**
 * At end of day (or when loading past dates), find all reminder slots
 * that were NOT taken and write them as missed_logs.
 * Uses a sentinel doc "missed_written/{isoDate}" to avoid duplicates.
 */
async function saveMissedLogsForDate(
  userId: string,
  date: Date,
  reminders: Reminder[],
  medications: Medication[],
  takenLogs: TakenLog[],
): Promise<void> {
  const normalizedDate = normalizeDate(date);
  const dk = dateKey(normalizedDate);
  const iso = isoDateKey(normalizedDate);

  // Guard: only write for dates strictly in the past
  const today = normalizeDate(new Date());
  if (normalizedDate >= today) return;

  // Check if we already wrote missed logs for this date
  const sentinelRef = doc(db, "users", userId, "missed_written", iso);
  const { getDoc } = await import("firebase/firestore");
  const sentinel = await getDoc(sentinelRef);
  if (sentinel.exists()) return; // already written

  const activeReminders = getRemindersForDate(
    normalizedDate,
    reminders,
    medications,
  );
  const logsForDate = takenLogs.filter((l) => l.dateKey === dk);

  const batch = writeBatch(db);

  for (const reminder of activeReminders) {
    for (const time of reminder.times || ["08:00"]) {
      // A log matches if reminderId is `${r.id}_${time}` OR just `r.id`
      const wasTaken = logsForDate.some(
        (l) =>
          l.reminderId === `${reminder.id}_${time}` ||
          l.reminderId === reminder.id,
      );

      if (!wasTaken) {
        const missedRef = doc(collection(db, "users", userId, "missed_logs"));
        batch.set(missedRef, {
          medicationId: reminder.medicationId,
          reminderId: reminder.id,
          name: reminder.medicationName,
          dosage: reminder.medicationDosage,
          scheduledTime: time,
          dateKey: dk,
          missedAt: serverTimestamp(),
        });
      }
    }
  }

  // Write the sentinel so we never duplicate
  batch.set(sentinelRef, { writtenAt: serverTimestamp(), dateKey: dk });

  await batch.commit();
}
const getReminderLogId = (
  reminderId: string,
  time: string,
  dateKey: string,
): string => {
  return `${reminderId}_${time}_${dateKey.replace(/\s/g, "_")}`;
};

// Initialize today's reminders as "not-taken"
async function initializeTodayReminderLogs(
  userId: string,
  today: Date,
  reminders: Reminder[],
  medications: Medication[],
): Promise<void> {
  const normalizedDate = normalizeDate(today);
  const dk = dateKey(normalizedDate);
  const activeReminders = getRemindersForDate(
    normalizedDate,
    reminders,
    medications,
  );

  if (activeReminders.length === 0) return;

  const batch = writeBatch(db);
  let hasChanges = false;

  for (const reminder of activeReminders) {
    for (const time of reminder.times || ["08:00"]) {
      const logId = getReminderLogId(reminder.id, time, dk);
      const logRef = doc(db, "users", userId, "reminder_status_logs", logId);

      // Check if log already exists
      const { getDoc } = await import("firebase/firestore");
      const existingLog = await getDoc(logRef);

      if (!existingLog.exists()) {
        batch.set(logRef, {
          reminderId: reminder.id,
          medicationId: reminder.medicationId,
          name: reminder.medicationName,
          dosage: reminder.medicationDosage,
          scheduledTime: time,
          dateKey: dk,
          status: "not-taken",
          updatedAt: serverTimestamp(),
        });
        hasChanges = true;
      }
    }
  }

  if (hasChanges) {
    await batch.commit();
  }
}

// Initialize today's reminders as "not-taken"

async function updateReminderStatuses(
  userId: string,
  today: Date,
  reminders: Reminder[],
  medications: Medication[],
  takenLogs: TakenLog[],
): Promise<void> {
  const normalizedDate = normalizeDate(today);
  const dk = dateKey(normalizedDate);
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const activeReminders = getRemindersForDate(
    normalizedDate,
    reminders,
    medications,
  );
  const logsForDate = takenLogs.filter((l) => l.dateKey === dk);

  const batch = writeBatch(db);
  let hasChanges = false;

  for (const reminder of activeReminders) {
    for (const time of reminder.times || ["08:00"]) {
      const logId = getReminderLogId(reminder.id, time, dk);
      const logRef = doc(db, "users", userId, "reminder_status_logs", logId);

      // Check if already taken in taken_logs
      const timeSpecificId = `${reminder.id}_${time}`;
      const takenLog = logsForDate.find(
        (l) => l.reminderId === timeSpecificId || l.reminderId === reminder.id,
      );

      if (takenLog) {
        // Already taken, update status to "taken" if not already
        const { getDoc } = await import("firebase/firestore");
        const existingLog = await getDoc(logRef);

        if (existingLog.exists() && existingLog.data()?.status !== "taken") {
          const variance = getTakenVariance(time, takenLog);

          batch.update(logRef, {
            status: "taken",
            takenAt: takenLog.takenAt,
            takenVariance: variance,
            updatedAt: serverTimestamp(),
          });
          hasChanges = true;
        }
        continue;
      }

      // Check if not taken - determine status based on time
      const { getDoc } = await import("firebase/firestore");
      const existingLog = await getDoc(logRef);
      if (!existingLog.exists()) continue;

      const scheduledMinutes = toMinutes(time);
      const diff = currentMinutes - scheduledMinutes;
      let newStatus: "not-taken" | "late" | "missed" = "not-taken";

      // Soft missed = 6 hours (360 minutes)
      const SOFT_MISSED_THRESHOLD = 360; // 6 hours

      if (diff >= SOFT_MISSED_THRESHOLD) {
        newStatus = "missed";
      } else if (diff >= LATE_THRESHOLD) {
        newStatus = "late";
      }

      const currentStatus = existingLog.data()?.status;
      if (currentStatus !== newStatus && newStatus !== "not-taken") {
        batch.update(logRef, {
          status: newStatus,
          updatedAt: serverTimestamp(),
        });
        hasChanges = true;
      }
    }
  }

  if (hasChanges) {
    await batch.commit();
  }
}
const toMinutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

async function backfillReminderStatusLogs(
  userId: string,
  date: Date,
  reminders: Reminder[],
  medications: Medication[],
  takenLogs: TakenLog[],
): Promise<void> {
  const normalizedDate = normalizeDate(date);
  const dk = dateKey(normalizedDate);
  const iso = isoDateKey(normalizedDate);

  // Use a sentinel to avoid re-processing days we've already backfilled
  const sentinelRef = doc(db, "users", userId, "status_backfilled", iso);
  const { getDoc } = await import("firebase/firestore");
  const sentinel = await getDoc(sentinelRef);
  if (sentinel.exists()) return;

  const activeReminders = getRemindersForDate(
    normalizedDate,
    reminders,
    medications,
  );
  if (activeReminders.length === 0) {
    // Still write sentinel so we don't check again
    await setDoc(sentinelRef, { writtenAt: serverTimestamp() });
    return;
  }

  const logsForDate = takenLogs.filter((l) => l.dateKey === dk);
  const batch = writeBatch(db);

  for (const reminder of activeReminders) {
    for (const time of reminder.times || ["08:00"]) {
      const logId = getReminderLogId(reminder.id, time, dk);
      const logRef = doc(db, "users", userId, "reminder_status_logs", logId);

      const existingLog = await getDoc(logRef);
      if (existingLog.exists()) continue; // already written, skip

      // Check if it was taken
      const timeSpecificId = `${reminder.id}_${time}`;
      const takenLog = logsForDate.find(
        (l) => l.reminderId === timeSpecificId || l.reminderId === reminder.id,
      );

      if (takenLog) {
        const variance = getTakenVariance(time, takenLog);
        batch.set(logRef, {
          reminderId: reminder.id,
          medicationId: reminder.medicationId,
          name: reminder.medicationName,
          dosage: reminder.medicationDosage,
          scheduledTime: time,
          dateKey: dk,
          status: "taken",
          takenAt: takenLog.takenAt,
          takenVariance: variance,
          updatedAt: serverTimestamp(),
        });
      } else {
        // Missed — it's a past day and was not taken
        batch.set(logRef, {
          reminderId: reminder.id,
          medicationId: reminder.medicationId,
          name: reminder.medicationName,
          dosage: reminder.medicationDosage,
          scheduledTime: time,
          dateKey: dk,
          status: "missed",
          updatedAt: serverTimestamp(),
        });
      }
    }
  }

  batch.set(sentinelRef, { writtenAt: serverTimestamp() });
  await batch.commit();
}

// ─────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────
export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();

  const { addNotification } = useNotifications();

  const [medications, setMedications] = useState<Medication[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [takenLogs, setTakenLogs] = useState<TakenLog[]>([]);
  const [missedLogs, setMissedLogs] = useState<MissedLog[]>([]);
  const [interactions, setInteractions] = useState<InteractionInfo[]>([]);
  const [loadingInteractions, setLoadingInteractions] = useState(false);
  const [interactionsLoaded, setInteractionsLoaded] = useState(false);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [reminderStatusLogs, setReminderStatusLogs] = useState<
    ReminderStatusLog[]
  >([]);

  // Quick Take modal state
  const [quickTakeVisible, setQuickTakeVisible] = useState(false);
  const [quickTakeForm, setQuickTakeForm] = useState({
    medicationId: "",
    name: "",
    dosageAmount: 0, // ✅ Add
    dosageUnit: "mg",
    time: "",
  });
  const [quickTakeSearch, setQuickTakeSearch] = useState<
    MedicineSearchResult[]
  >([]);
  const [quickTakeSearching, setQuickTakeSearching] = useState(false);
  const [quickTakeShowSuggestions, setQuickTakeShowSuggestions] =
    useState(false);

  const { selectedPatientId, setSelectedPatientId, userType } =
    useSelectedPatient();
  const [patients, setPatients] = useState<{ id: string; name: string }[]>([]);
  const [showPatientSelector, setShowPatientSelector] = useState(false);

  const notifiedLateRef = useRef<Set<string>>(new Set());
  const notifiedMissedRef = useRef<Set<string>>(new Set());
  const notifiedConsecutiveRef = useRef<Set<string>>(new Set());
  const notifiedInteractionsRef = useRef<Set<string>>(new Set());
  const notifiedRequestsRef = useRef<Set<string>>(new Set());
  const caregiverNotifiedMissedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const runChecks = async () => {
      const userId = auth.currentUser?.uid;
      if (!userId) return;

      // Check for late/missed doses
      await checkMissedAndLateDoses(
        reminders,
        takenLogs,
        addNotification,
        notifiedLateRef,
        notifiedMissedRef,
      );

      // Check for consecutive missed days
      await checkConsecutiveMissedDays(
        reminders,
        takenLogs,
        addNotification,
        notifiedConsecutiveRef,
      );

      // Check for severe interactions
      if (interactions.length > 0) {
        await checkSevereInteractions(
          medications,
          interactions,
          addNotification,
          notifiedInteractionsRef,
        );
      }

      // Check for caregiver requests (for patients)
      if (userType === "patient") {
        await checkCaregiverRequests(
          userId,
          addNotification,
          notifiedRequestsRef,
        );
      }

      // Check for patient missed doses (for caregivers)
      if (userType === "caregiver" && patients.length > 0) {
        await checkCaregiverPatientMissedDoses(
          patients,
          addNotification,
          caregiverNotifiedMissedRef,
        );
      }
    };

    // Run immediately
    runChecks();

    // Run every minute
    const interval = setInterval(runChecks, 60000);

    return () => clearInterval(interval);
  }, [reminders, takenLogs, medications, interactions, patients, userType]);

  const scrollViewRef = useRef<ScrollView>(null);
  const missedWrittenDates = useRef<Set<string>>(new Set());
  const today = normalizeDate(new Date());
  const isTodaySelected =
    normalizeDate(selectedDate).getTime() === today.getTime();
  // AFTER the existing isTodaySelected line:
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const isYesterdaySelected =
    normalizeDate(selectedDate).getTime() ===
    normalizeDate(yesterday).getTime();

  // Take button appears for today AND yesterday only
  const canTakeOnSelectedDate = isTodaySelected || isYesterdaySelected;

  // ─── Calendar days ────────────────────────────
  const generateDays = () => {
    const days = [];
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - 15);
    for (let i = 0; i < 60; i++) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + i);
      days.push(date);
    }
    return days;
  };
  const days = generateDays();

  const { can, loading: permissionsLoading } = useCaregiverPermissions({
    patientId: userType === "caregiver" ? selectedPatientId || "" : "",
    caregiverId: userType === "caregiver" ? auth.currentUser?.uid || "" : "",
  });

  // ✅ Memoize this to prevent recreation on every render
  const safeCan = useMemo(
    () => ({
      markAsTaken: () =>
        userType === "caregiver" ? (can?.markAsTaken() ?? false) : true,
    }),
    [userType, can],
  );

  useEffect(() => {
    const timer = setTimeout(() => scrollToToday(), 100);
    return () => clearTimeout(timer);
  }, []);

  // ─── Firebase listeners ───────────────────────
  useEffect(() => {
    const targetUserId =
      userType === "caregiver" ? selectedPatientId : auth.currentUser?.uid;

    if (!targetUserId) return;

    const unsubMeds = onSnapshot(
      query(
        collection(db, "users", targetUserId, "medications"),
        orderBy("createdAt", "desc"),
      ),
      (snap) => {
        setMedications(
          snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Medication[],
        );
        setInteractionsLoaded(false);
      },
    );

    const unsubReminders = onSnapshot(
      collection(db, "users", targetUserId, "reminders"),
      (snap) => {
        setReminders(
          snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Reminder[],
        );
      },
    );

    const unsubTaken = onSnapshot(
      collection(db, "users", targetUserId, "taken_logs"),
      (snap) => {
        setTakenLogs(
          snap.docs.map((d) => ({ id: d.id, ...d.data() })) as TakenLog[],
        );
      },
    );

    const unsubMissed = onSnapshot(
      collection(db, "users", targetUserId, "missed_logs"),
      (snap) => {
        setMissedLogs(
          snap.docs.map((d) => ({ id: d.id, ...d.data() })) as MissedLog[],
        );
      },
    );

    // ADD THIS NEW LISTENER:
    const unsubReminderStatus = onSnapshot(
      collection(db, "users", targetUserId, "reminder_status_logs"),
      (snap) => {
        setReminderStatusLogs(
          snap.docs.map((d) => ({
            id: d.id,
            ...d.data(),
          })) as ReminderStatusLog[],
        );
      },
    );

    return () => {
      unsubMeds();
      unsubReminders();
      unsubTaken();
      unsubMissed();
      unsubReminderStatus(); // ADD THIS
    };
  }, [selectedPatientId, userType]);

  // ─── Write missed logs when a past date is selected ──────────
  useEffect(() => {
    const targetUserId =
      userType === "caregiver" ? selectedPatientId : auth.currentUser?.uid;
    if (!targetUserId) return;

    const normalizedDate = normalizeDate(selectedDate);
    const iso = isoDateKey(normalizedDate);

    // Only trigger for past dates and only once per date per session
    if (normalizedDate >= today) return;
    if (missedWrittenDates.current.has(iso)) return;
    if (reminders.length === 0) return;

    missedWrittenDates.current.add(iso);

    saveMissedLogsForDate(
      targetUserId,
      normalizedDate,
      reminders,
      medications,
      takenLogs,
    ).catch(console.warn);
  }, [
    selectedDate,
    reminders,
    medications,
    takenLogs,
    selectedPatientId,
    userType,
  ]);

  // ─── Also write missed logs for yesterday at startup ─────────
  useEffect(() => {
    const targetUserId =
      userType === "caregiver" ? selectedPatientId : auth.currentUser?.uid;
    if (!targetUserId || reminders.length === 0) return;

    const iso = isoDateKey(yesterday);

    if (missedWrittenDates.current.has(iso)) return;
    missedWrittenDates.current.add(iso);

    saveMissedLogsForDate(
      targetUserId,
      yesterday,
      reminders,
      medications,
      takenLogs,
    ).catch(console.warn);
  }, [reminders, medications, takenLogs, selectedPatientId, userType]);

  useEffect(() => {
    const targetUserId =
      userType === "caregiver" ? selectedPatientId : auth.currentUser?.uid;
    if (!targetUserId || reminders.length === 0) return;

    const iso = isoDateKey(yesterday); // ← just use the component-level `yesterday`

    if (missedWrittenDates.current.has(iso)) return;
    missedWrittenDates.current.add(iso);

    saveMissedLogsForDate(
      targetUserId,
      yesterday,
      reminders,
      medications,
      takenLogs,
    ).catch(console.warn);
  }, [reminders, medications, takenLogs, selectedPatientId, userType]);

  // ─── Load interactions ────────────────────────
  useEffect(() => {
    if (!interactionsLoaded && medications.length > 0) loadInteractions();
  }, [medications, interactionsLoaded]);

  const loadInteractions = async () => {
    setLoadingInteractions(true);
    const activeMeds = medications.filter((m) => m.active && m.drug_id);
    const allInteractions: InteractionInfo[] = [];

    for (let i = 0; i < activeMeds.length; i++) {
      const otherIds = activeMeds
        .filter((_, j) => j !== i)
        .map((m) => m.drug_id);
      if (otherIds.length > 0) {
        const warnings = await checkAllInteractions(
          activeMeds[i].drug_id,
          otherIds,
        );
        allInteractions.push(...warnings);
      }
    }

    const seen = new Set<string>();
    const deduped = allInteractions.filter((w) => {
      const key = [w.drug_id, w.interacts_with].sort().join("-");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    setInteractions(deduped);
    setLoadingInteractions(false);
    setInteractionsLoaded(true);
  };

  // ─── Build schedule ───────────────────────────
  useEffect(() => {
    buildSchedule(selectedDate);
  }, [
    selectedDate,
    reminders,
    medications,
    interactions,
    takenLogs,
    missedLogs,
  ]);

  // ─── Load patients for caregivers ─────────────
  useEffect(() => {
    const userId = auth.currentUser?.uid;
    if (!userId || userType !== "caregiver") return;

    const q = query(
      collection(db, "caregiver_connections"),
      where("caregiverId", "==", userId),
      where("status", "==", "approved"),
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const patientList = snapshot.docs.map((doc) => ({
        id: doc.data().patientId,
        name: doc.data().patientName,
      }));
      setPatients(patientList);

      if (patientList.length > 0 && !selectedPatientId) {
        setSelectedPatientId(patientList[0].id);
      }
    });

    return unsubscribe;
  }, [userType, selectedPatientId]);

  const buildSchedule = (date: Date) => {
    const normalizedDate = normalizeDate(date);
    const dk = dateKey(normalizedDate);
    const isPastDay = normalizedDate < today;
    const isTodayDay = normalizedDate.getTime() === today.getTime();
    const logsForDate = takenLogs.filter((l) => l.dateKey === dk);
    const now = new Date();
    const currentTimeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    if (isPastDay) {
      const takenItems: ScheduleItem[] = logsForDate
        .filter((l) => l.reminderId !== "quick-take")
        .map((l) => {
          const parts = l.reminderId.split("_");
          const lastPart = parts[parts.length - 1];
          const scheduledTime =
            parts.length >= 2 && /^\d{2}:\d{2}$/.test(lastPart)
              ? lastPart
              : "00:00";

          const actualTakenTime = l.takenAt?.toDate
            ? l.takenAt.toDate().toTimeString().slice(0, 5)
            : null;

          return {
            reminderId: l.reminderId,
            medicationId: l.medicationId,
            name: l.name,
            dosageAmount: l.dosageAmount,
            dosageUnit: l.dosageUnit || "mg",
            time: scheduledTime,
            actualTakenTime,
            taken: true,
            missed: false,
            missedSoft: false,
            late: false,
            takenLogId: l.id,
            takenVariance: getTakenVariance(scheduledTime, l),
            hasInteraction: false,
            interactionSeverity: null,
            interactionCount: 0,
          };
        });

      // Check active reminders for missed doses
      const activeRemindersForDate = getRemindersForDate(
        normalizedDate,
        reminders,
        medications,
      );

      const reminderMissedItems: ScheduleItem[] =
        activeRemindersForDate.flatMap((r) =>
          (r.times || ["08:00"])
            .map((time) => {
              const timeSpecificId = `${r.id}_${time}`;
              const wasTaken = logsForDate.some(
                (l) => l.reminderId === timeSpecificId || l.reminderId === r.id,
              );
              if (wasTaken) return null;

              const med = medications.find((m) => m.id === r.medicationId);
              return {
                reminderId: r.id,
                medicationId: r.medicationId,
                name: r.medicationName,
                dosageAmount: med?.dosageAmount,
                dosageUnit: med?.dosageUnit || "mg",
                time,
                actualTakenTime: null,
                taken: false,
                missed: true,
                missedSoft: false,
                late: false,
                takenLogId: undefined,
                takenVariance: null,
                hasInteraction: false,
                interactionSeverity: null,
                interactionCount: 0,
              } as ScheduleItem;
            })
            .filter((item): item is ScheduleItem => item !== null),
        );

      // Legacy: missed_logs for deleted/disabled reminders no longer in activeRemindersForDate
      const missedForDate = missedLogs.filter((l) => l.dateKey === dk);
      const legacyMissedItems: ScheduleItem[] = missedForDate
        .filter(
          (m) =>
            !logsForDate.some(
              (l) =>
                l.reminderId === `${m.reminderId}_${m.scheduledTime}` ||
                l.reminderId === m.reminderId,
            ) && !activeRemindersForDate.some((r) => r.id === m.reminderId),
        )
        .map((m) => {
          const med = medications.find((med) => med.id === m.medicationId);
          return {
            reminderId: m.reminderId,
            medicationId: m.medicationId,
            name: m.name,
            dosageAmount: med?.dosageAmount,
            dosageUnit: med?.dosageUnit || "mg",
            time: m.scheduledTime,
            actualTakenTime: null,
            taken: false,
            missed: true,
            missedSoft: false,
            late: false,
            takenLogId: undefined,
            takenVariance: null,
            hasInteraction: false,
            interactionSeverity: null,
            interactionCount: 0,
          };
        });

      const quickTakes: ScheduleItem[] = logsForDate
        .filter((l) => l.reminderId === "quick-take")
        .map((l) => ({
          reminderId: l.id,
          medicationId: l.medicationId,
          name: l.name,
          dosageAmount: l.dosageAmount,
          dosageUnit: l.dosageUnit || "mg",
          time: l.takenAt?.toDate
            ? l.takenAt.toDate().toTimeString().slice(0, 5)
            : "00:00",
          actualTakenTime: null,
          taken: true,
          missed: false,
          missedSoft: false,
          late: false,
          takenLogId: l.id,
          takenVariance: null,
          hasInteraction: false,
          interactionSeverity: null,
          interactionCount: 0,
        }));

      const all = [
        ...takenItems,
        ...reminderMissedItems,
        ...legacyMissedItems,
        ...quickTakes,
      ];
      all.sort((a, b) => a.time.localeCompare(b.time));
      setSchedule(all);
      return;
    }
    // Today / future: calculate from reminders
    // ✅ FIX: Include all reminders that are active OR have been taken today
    const dayReminders = getRemindersForDate(
      normalizedDate,
      reminders,
      medications,
    );

    // ✅ Also include reminders that were taken today but might not be active (e.g., one-time reminders that already passed)
    const takenReminderIds = logsForDate
      .filter((l) => l.reminderId !== "quick-take")
      .map((l) => {
        // Extract base reminder ID (remove time suffix if present)
        if (l.reminderId.includes("_")) {
          return l.reminderId.split("_")[0];
        }
        return l.reminderId;
      });

    // Find reminders that were taken today but not in dayReminders (one-time reminders that are done)
    const additionalReminders = takenReminderIds
      .filter((id) => !dayReminders.some((r) => r.id === id))
      .map((id) => reminders.find((r) => r.id === id))
      .filter((r): r is Reminder => r !== undefined);

    const allRemindersForDate = [...dayReminders, ...additionalReminders];

    const items: ScheduleItem[] = allRemindersForDate.flatMap((r) => {
      return (r.times || ["08:00"]).map((time) => {
        const med = medications.find((m) => m.id === r.medicationId);
        const sameDayDrugIds = dayReminders
          .filter((dr) => dr.medicationId !== r.medicationId)
          .map(
            (dr) => medications.find((m) => m.id === dr.medicationId)?.drug_id,
          )
          .filter(Boolean) as string[];

        const medInteractions = interactions.filter(
          (i) =>
            (i.drug_id === med?.drug_id &&
              sameDayDrugIds.includes(i.interacts_with)) ||
            (i.interacts_with === med?.drug_id &&
              sameDayDrugIds.includes(i.drug_id)),
        );

        const hasSevere = medInteractions.some(
          (i) => getInteractionSeverity(i.description) === "severe",
        );

        // Check for time-specific reminderId first
        const timeSpecificId = `${r.id}_${time}`;
        const takenLog = logsForDate.find(
          (l) => l.reminderId === timeSpecificId || l.reminderId === r.id,
        );
        const nowMinutes = toMinutes(currentTimeStr);
        const scheduledMinutes = toMinutes(time);
        const diff = nowMinutes - scheduledMinutes;

        const isLate =
          isTodayDay &&
          !takenLog &&
          diff >= LATE_THRESHOLD &&
          diff < SOFT_MISSED_THRESHOLD;

        const isMissedSoft =
          isTodayDay && !takenLog && diff >= SOFT_MISSED_THRESHOLD;

        return {
          reminderId: r.id,
          medicationId: r.medicationId,
          name: r.medicationName,
          dosageAmount: med?.dosageAmount, // ← add this
          dosageUnit: med?.dosageUnit || "mg",
          time,
          actualTakenTime: takenLog?.takenAt?.toDate
            ? takenLog.takenAt.toDate().toTimeString().slice(0, 5)
            : null,
          taken: !!takenLog,
          missed: false,
          late: isLate,
          missedSoft: isMissedSoft,
          takenLogId: takenLog?.id,
          takenVariance: takenLog ? getTakenVariance(time, takenLog) : null,
          hasInteraction: medInteractions.length > 0,
          interactionSeverity:
            medInteractions.length > 0 ? (hasSevere ? "severe" : "mild") : null,
          interactionCount: medInteractions.length,
        };
      });
    });

    items.sort((a, b) => a.time.localeCompare(b.time));
    setSchedule(items);
  };

  const toggleTaken = async (item: ScheduleItem) => {
    if (!safeCan.markAsTaken()) {
      Alert.alert(
        "Permission Denied",
        "You don't have permission to mark medications as taken for this patient.",
      );
      return;
    }

    const targetUserId =
      userType === "caregiver" ? selectedPatientId : auth.currentUser?.uid;

    if (!targetUserId) {
      Alert.alert("Error", "Could not determine the target user");
      return;
    }

    console.log("🎯 Target user ID:", targetUserId);
    console.log("User type:", userType);

    const dk = dateKey(selectedDate);
    const logId = getReminderLogId(item.reminderId, item.time, dk);
    const logRef = doc(
      db,
      "users",
      targetUserId,
      "reminder_status_logs",
      logId,
    ); // ✅ Use targetUserId

    if (item.taken && item.takenLogId) {
      // Undo logic - update BOTH collections
      Alert.alert(
        "Undo taken?",
        "This will mark this medication as not taken.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Undo",
            style: "destructive",
            onPress: async () => {
              // Update reminder_status_log
              await updateDoc(logRef, {
                status: "not-taken",
                takenAt: null,
                takenVariance: null,
                updatedAt: serverTimestamp(),
              });
              // Delete from taken_logs
              await deleteDoc(
                doc(db, "users", targetUserId, "taken_logs", item.takenLogId!), // ✅ Use targetUserId
              );
            },
          },
        ],
      );
      return;
    }

    try {
      const now = new Date();
      const takenVariance = getTakenVarianceForTime(item.time, now);

      // UPDATE reminder_status_log (Primary)
      await setDoc(logRef, {
        reminderId: item.reminderId,
        medicationId: item.medicationId,
        name: item.name,
        dosage:
          item.dosageAmount != null
            ? `${item.dosageAmount} ${item.dosageUnit || "mg"}`
            : null,
        scheduledTime: item.time,
        dateKey: dk,
        status: "taken",
        takenAt: serverTimestamp(),
        takenVariance: takenVariance,
        updatedAt: serverTimestamp(),
      });

      // ALSO keep taken_logs for backward compatibility
      const timeSpecificReminderId = `${item.reminderId}_${item.time}`;
      await addDoc(collection(db, "users", targetUserId, "taken_logs"), {
        // ✅ Use targetUserId
        medicationId: item.medicationId,
        reminderId: timeSpecificReminderId,
        name: item.name,
        dosage:
          item.dosageAmount != null
            ? `${item.dosageAmount} ${item.dosageUnit || "mg"}`
            : null,
        takenAt: serverTimestamp(),
        dateKey: dk,
      });

      console.log(`✅ Marked as taken in BOTH collections`);
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to mark as taken");
    }
  };
  // Helper function
  function getTakenVarianceForTime(
    scheduledTime: string,
    takenAt: Date,
  ): "early" | "late" | "on-time" | null {
    const takenMinutes = takenAt.getHours() * 60 + takenAt.getMinutes();
    const [sh, sm] = scheduledTime.split(":").map(Number);
    const scheduledMinutes = sh * 60 + sm;
    const diff = takenMinutes - scheduledMinutes;
    if (diff > 60) return "late";
    if (diff < -60) return "early";
    return "on-time";
  }

  // ─── Quick Take ───────────────────────────────
  const openQuickTake = (med?: Medication) => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    setQuickTakeForm({
      medicationId: med?.id ?? "",
      name: med?.name ?? "",
      dosageAmount: med?.dosageAmount ?? 0, // ✅ Add
      dosageUnit: med?.dosageUnit ?? "mg",
      time: `${hh}:${mm}`,
    });
    setQuickTakeSearch([]);
    setQuickTakeShowSuggestions(false);
    setQuickTakeVisible(true);
  };

  const closeQuickTake = () => {
    setQuickTakeVisible(false);
    setQuickTakeSearch([]);
    setQuickTakeShowSuggestions(false);
  };

  const handleQuickTakeSearch = useCallback(async (text: string) => {
    setQuickTakeForm((p) => ({ ...p, name: text, medicationId: "" }));
    if (text.length < 2) {
      setQuickTakeSearch([]);
      setQuickTakeShowSuggestions(false);
      return;
    }
    setQuickTakeSearching(true);
    setQuickTakeShowSuggestions(true);
    const results = await searchMedicines(text);
    setQuickTakeSearch(results);
    setQuickTakeSearching(false);
  }, []);

  const handleQuickTakeSelect = (item: MedicineSearchResult) => {
    setQuickTakeForm((p) => ({
      ...p,
      name: item.ph_brand,
      medicationId: item.drug_id,
    }));
    setQuickTakeSearch([]);
    setQuickTakeShowSuggestions(false);
  };

  const submitQuickTake = async () => {
    if (!quickTakeForm.name.trim()) {
      Alert.alert("Error", "Please enter a medication name");
      return;
    }
    const targetUserId =
      userType === "caregiver" ? selectedPatientId : auth.currentUser?.uid;
    if (!targetUserId) {
      Alert.alert("Error", "Could not determine the target user");
      return;
    }
    try {
      const dosageString = `${quickTakeForm.dosageAmount || 0} ${quickTakeForm.dosageUnit || "mg"}`;

      await addDoc(collection(db, "users", targetUserId, "taken_logs"), {
        medicationId: quickTakeForm.medicationId || null,
        reminderId: "quick-take",
        name: quickTakeForm.name.trim(),
        dosageAmount: quickTakeForm.dosageAmount || 0, // ✅ New format
        dosageUnit: quickTakeForm.dosageUnit || "mg",
        takenAt: serverTimestamp(),
        dateKey: dateKey(selectedDate),
      });
      closeQuickTake();
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to log");
    }
  };

  // ─── Navigation ───────────────────────────────
  const scrollToToday = () => {
    const todayIndex = days.findIndex(
      (d) => normalizeDate(d).getTime() === today.getTime(),
    );
    if (todayIndex > -1 && scrollViewRef.current) {
      scrollViewRef.current.scrollTo({
        x: (todayIndex - 2) * DAY_WIDTH,
        animated: true,
      });
      setSelectedDate(today);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setInteractionsLoaded(false);
    scrollToToday();
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  const refreshDataForPatient = useCallback(async (_patientId: string) => {
    setInteractionsLoaded(false);
  }, []);

  // ─── Calendar helpers ─────────────────────────
  const isToday = (d: Date) => normalizeDate(d).getTime() === today.getTime();
  const isSelected = (d: Date) =>
    normalizeDate(d).getTime() === normalizeDate(selectedDate).getTime();
  const isPast = (d: Date) => normalizeDate(d) < today;
  const isFuture = (d: Date) => normalizeDate(d) > today;

  const formatDate = (date: Date) =>
    date.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

  const getDayLabel = (date: Date) => {
    const normalized = normalizeDate(date);
    if (isToday(normalized)) return "Today's Medications";
    if (isPast(normalized)) return formatDate(normalized);
    return `Upcoming — ${formatDate(normalized)}`;
  };

  const getDotStatus = (date: Date): "none" | "grey" | "green" | "red" => {
    const normalizedDate = normalizeDate(date);

    if (isPast(normalizedDate)) {
      const dk = dateKey(normalizedDate);
      const logsForDate = takenLogs.filter((l) => l.dateKey === dk);
      const missedForDate = missedLogs.filter((l) => l.dateKey === dk);

      if (logsForDate.length === 0 && missedForDate.length === 0) return "none";
      if (missedForDate.length > 0) return "red";
      return "green";
    }

    const remindersForDate = getRemindersForDate(
      normalizedDate,
      reminders,
      medications,
    );
    return remindersForDate.length > 0 ? "grey" : "none";
  };

  const dotColorValue = (status: ReturnType<typeof getDotStatus>) => {
    if (status === "green") return Colors.success;
    if (status === "red") return Colors.error;
    return "rgba(255,255,255,0.7)";
  };

  const scheduledInteractions = schedule.filter((item) => item.hasInteraction);
  const severeCount = scheduledInteractions.filter(
    (item) => item.interactionSeverity === "severe",
  ).length;
  const mildCount = scheduledInteractions.filter(
    (item) => item.interactionSeverity === "mild",
  ).length;
  const hasAnyInteractionOnDate = scheduledInteractions.length > 0;

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: Colors.primary }}>
      <SafeAreaView
        style={[styles.container, { backgroundColor: Colors.background }]}
        edges={["bottom", "left", "right"]}
      >
        <StatusBar
          style="dark"
          backgroundColor={Colors.primary}
          translucent={false}
        />
        {/* Top Header */}
        <View style={[styles.mainHeader, { paddingTop: insets.top + 5 }]}>
          <Text style={styles.headerTitle}>MEDGUARD</Text>
          <View style={styles.headerIcons}>
            <NotificationBell />
            {/* <TouchableOpacity style={styles.iconButton}>
            <Ionicons name="person-outline" size={24} color={Colors.surface} />
          </TouchableOpacity> */}
          </View>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[Colors.primary]}
              tintColor={Colors.primary}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          {/* Patient Selector for Caregivers */}
          {patients.length > 0 && (
            <View style={styles.patientSelectorContainer}>
              <Text style={styles.patientSelectorLabel}>Patient:</Text>
              <TouchableOpacity
                style={styles.patientSelectorButton}
                onPress={() => setShowPatientSelector(!showPatientSelector)}
              >
                <Text style={styles.patientSelectorText}>
                  {patients.find((p) => p.id === selectedPatientId)?.name ||
                    "Select Patient"}
                </Text>
                <Ionicons name="chevron-down" size={18} color={Colors.text} />
              </TouchableOpacity>

              {showPatientSelector && (
                <View style={styles.patientDropdown}>
                  {patients.map((patient) => (
                    <TouchableOpacity
                      key={patient.id}
                      style={styles.patientDropdownItem}
                      onPress={() => {
                        setSelectedPatientId(patient.id);
                        setShowPatientSelector(false);
                        refreshDataForPatient(patient.id);
                      }}
                    >
                      <Text style={styles.patientDropdownText}>
                        {patient.name}
                      </Text>
                      {selectedPatientId === patient.id && (
                        <Ionicons
                          name="checkmark"
                          size={18}
                          color={Colors.primary}
                        />
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* Date Header */}
          <View style={styles.header}>
            <View style={styles.headerTopRow}>
              <View style={styles.dateHeader}>
                <Text style={styles.todayText}>Today</Text>
                <Text style={styles.fullDate}>{formatDate(today)}</Text>
              </View>
              <TouchableOpacity
                style={[
                  styles.todayButton,
                  isTodaySelected
                    ? styles.todayButtonActive
                    : styles.todayButtonInactive,
                ]}
                onPress={scrollToToday}
              >
                <Ionicons
                  name="today"
                  size={20}
                  color={isTodaySelected ? Colors.primary : Colors.surface}
                />
                <Text
                  style={[
                    styles.todayButtonText,
                    isTodaySelected
                      ? styles.todayButtonTextActive
                      : styles.todayButtonTextInactive,
                  ]}
                >
                  Today
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Horizontal Calendar */}
          <View style={styles.calendarContainer}>
            <ScrollView
              ref={scrollViewRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.calendarContent}
              snapToInterval={DAY_WIDTH}
              decelerationRate="fast"
            >
              {days.map((date, index) => {
                const dotStatus = getDotStatus(date);
                return (
                  <TouchableOpacity
                    key={index}
                    style={[
                      styles.dayContainer,
                      isToday(date) &&
                        !isSelected(date) &&
                        styles.calendarTodayContainer,

                      isSelected(date) && styles.selectedContainer,
                    ]}
                    onPress={() => setSelectedDate(date)}
                  >
                    <Text
                      style={[
                        styles.dayName,
                        isToday(date) && styles.todayDayText,
                        isSelected(date) && styles.selectedText,
                      ]}
                    >
                      {DAY_NAMES[date.getDay()]}
                    </Text>
                    <Text
                      style={[
                        styles.dayNumber,
                        isToday(date) && styles.todayDayText,
                        isSelected(date) && styles.selectedText,
                      ]}
                    >
                      {date.getDate()}
                    </Text>
                    {dotStatus !== "none" && (
                      <View
                        style={[
                          styles.reminderDot,
                          {
                            backgroundColor:
                              isSelected(date) && dotStatus === "grey"
                                ? Colors.primary
                                : dotColorValue(dotStatus),
                          },
                        ]}
                      />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          <View style={styles.content}>
            {/* Interaction Warning Banner */}
            {hasAnyInteractionOnDate && (
              <TouchableOpacity
                style={[
                  styles.interactionBanner,
                  severeCount > 0 ? styles.severeBanner : styles.mildBanner,
                ]}
                onPress={() => {
                  router.navigate("/(tabs)/MedicationsScreen");
                  setTimeout(() => tabEvents.emit("openReactions"), 300);
                }}
              >
                <Ionicons
                  name={severeCount > 0 ? "warning" : "information-circle"}
                  size={20}
                  color={severeCount > 0 ? Colors.error : Colors.warning}
                />
                <View style={styles.bannerText}>
                  <Text
                    style={[
                      styles.bannerTitle,
                      {
                        color: severeCount > 0 ? Colors.error : Colors.warning,
                      },
                    ]}
                  >
                    {severeCount > 0
                      ? "Severe Interaction Detected"
                      : "Mild Interaction Detected"}
                  </Text>
                  <Text style={styles.bannerSubtitle}>
                    {severeCount > 0
                      ? `${severeCount} severe interaction${severeCount > 1 ? "s" : ""} between your medications`
                      : `${mildCount} mild interaction${mildCount > 1 ? "s" : ""} — check Reactions tab`}
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={Colors.textTertiary}
                />
              </TouchableOpacity>
            )}
            {/* Selected Date Label */}
            <View style={styles.selectedDateContainer}>
              <Text style={styles.selectedDateTitle}>
                {getDayLabel(selectedDate)}
              </Text>
              {isFuture(selectedDate) && (
                <View style={styles.futureBadge}>
                  <Text style={styles.futureBadgeText}>Upcoming</Text>
                </View>
              )}
              {isPast(selectedDate) && (
                <View style={styles.pastBadge}>
                  <Text style={styles.pastBadgeText}>Past</Text>
                </View>
              )}
            </View>
            {/* Schedule List */}
            {loadingInteractions && schedule.length === 0 ? (
              <View style={styles.loadingCard}>
                <ActivityIndicator size="small" color={Colors.primary} />
                <Text style={styles.loadingText}>Checking interactions...</Text>
              </View>
            ) : schedule.length > 0 ? (
              <View style={styles.medicationsCard}>
                {schedule.map((item, index) => (
                  <View
                    key={item.reminderId + index}
                    style={[
                      styles.medicationItem,
                      index === schedule.length - 1 &&
                        styles.medicationItemLast,
                      item.missed && styles.medicationItemMissed,
                    ]}
                  >
                    <View style={styles.timeColumn}>
                      <Text
                        style={[
                          styles.medTime,
                          item.missed && styles.medTimeMissed,
                        ]}
                      >
                        {formatTime12h(item.time)}
                      </Text>
                    </View>

                    <View style={styles.medInfo}>
                      <View style={styles.medNameRow}>
                        <Text
                          style={[
                            styles.medName,
                            item.missed && styles.medNameMissed,
                          ]}
                        >
                          {item.name}
                        </Text>
                        {item.taken && (
                          <View style={styles.takenBadge}>
                            <Ionicons
                              name="checkmark"
                              size={12}
                              color={Colors.success}
                            />
                            <Text style={styles.takenBadgeText}>Taken</Text>
                            {item.actualTakenTime && (
                              <Text
                                style={[
                                  styles.takenBadgeText,
                                  { color: Colors.textSecondary },
                                ]}
                              >
                                · {formatTime12h(item.actualTakenTime)}
                              </Text>
                            )}
                            {item.takenVariance === "late" && (
                              <Text
                                style={[
                                  styles.takenBadgeText,
                                  { color: Colors.warning },
                                ]}
                              >
                                · Late
                              </Text>
                            )}
                            {item.takenVariance === "early" && (
                              <Text
                                style={[
                                  styles.takenBadgeText,
                                  { color: Colors.primary },
                                ]}
                              >
                                · Early
                              </Text>
                            )}
                          </View>
                        )}
                        {item.missed && (
                          <View style={styles.missedBadge}>
                            <Ionicons
                              name="close"
                              size={12}
                              color={Colors.error}
                            />
                            <Text style={styles.missedBadgeText}>Missed</Text>
                          </View>
                        )}
                        {item.missedSoft && (
                          <View style={styles.missedBadge}>
                            <Ionicons
                              name="close"
                              size={12}
                              color={Colors.error}
                            />
                            <Text style={styles.missedBadgeText}>Missed</Text>
                          </View>
                        )}

                        {item.late && !item.missedSoft && (
                          <View style={styles.lateBadge}>
                            <Ionicons
                              name="time"
                              size={12}
                              color={Colors.warning}
                            />
                            <Text style={styles.lateBadgeText}>Late</Text>
                          </View>
                        )}
                      </View>
                      <Text
                        style={[
                          styles.medDosage,
                          item.missed && styles.medDosageMissed,
                        ]}
                      >
                        {`${item.dosageAmount ?? ""} ${item.dosageUnit ?? "mg"}`}
                      </Text>
                      {item.hasInteraction && (
                        <View style={styles.tagRow}>
                          <View
                            style={[
                              styles.interactionTag,
                              item.interactionSeverity === "severe"
                                ? styles.severeTag
                                : styles.mildTag,
                            ]}
                          >
                            <Ionicons
                              name="warning"
                              size={11}
                              color={
                                item.interactionSeverity === "severe"
                                  ? Colors.error
                                  : Colors.warning
                              }
                            />
                            <Text
                              style={[
                                styles.tagText,
                                {
                                  color:
                                    item.interactionSeverity === "severe"
                                      ? Colors.error
                                      : Colors.warning,
                                },
                              ]}
                            >
                              {item.interactionSeverity === "severe"
                                ? "Severe"
                                : "Mild"}{" "}
                              interaction
                              {item.interactionCount > 1
                                ? ` (${item.interactionCount})`
                                : ""}
                            </Text>
                          </View>
                        </View>
                      )}
                    </View>

                    {canTakeOnSelectedDate &&
                      (isTodaySelected || !item.taken) && (
                        <TouchableOpacity
                          style={[
                            styles.takeButton,
                            item.taken && styles.takenButton,
                            !safeCan.markAsTaken() && styles.disabledButton,
                          ]}
                          onPress={() => toggleTaken(item)}
                          disabled={!safeCan.markAsTaken()}
                        >
                          <Text
                            style={[
                              styles.takeButtonText,
                              item.taken && styles.takenButtonText,
                            ]}
                          >
                            {item.taken ? "✓" : "Take"}
                          </Text>
                        </TouchableOpacity>
                      )}
                    {isPast(selectedDate) &&
                      (!isYesterdaySelected || item.taken) && (
                        <View style={styles.pastTakenBadge}>
                          <Ionicons
                            name={
                              item.taken ? "checkmark-circle" : "close-circle"
                            }
                            size={22}
                            color={
                              item.taken ? Colors.success : Colors.error + "80"
                            }
                          />
                        </View>
                      )}
                    {isFuture(selectedDate) && (
                      <View style={styles.futureIcon}>
                        <Ionicons
                          name="time-outline"
                          size={20}
                          color={Colors.textTertiary}
                        />
                      </View>
                    )}
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.noMedicationsCard}>
                <Ionicons
                  name="calendar-outline"
                  size={60}
                  color={Colors.textTertiary}
                />
                <Text style={styles.noMedicationsText}>
                  {isPast(selectedDate)
                    ? "No medications were scheduled or taken on this day"
                    : isFuture(selectedDate)
                      ? "No medications scheduled for this day"
                      : "No medications scheduled for today"}
                </Text>
                {canTakeOnSelectedDate && (
                  <TouchableOpacity
                    style={[
                      styles.takeButton,
                      { marginTop: 16, paddingHorizontal: 20 },
                      !safeCan.markAsTaken() && styles.disabledButton,
                    ]}
                    onPress={() => openQuickTake()}
                    disabled={!safeCan.markAsTaken()}
                  >
                    <Text style={styles.takeButtonText}>Log a dose</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {takenLogs.filter(
              (l) =>
                l.dateKey === dateKey(selectedDate) &&
                l.reminderId === "quick-take",
            ).length > 0 && (
              <>
                <Text style={styles.sectionTitle}>As Needed</Text>
                <View style={styles.medicationsCard}>
                  {takenLogs
                    .filter(
                      (l) =>
                        l.dateKey === dateKey(selectedDate) &&
                        l.reminderId === "quick-take",
                    )
                    .map((log, index, arr) => (
                      <View
                        key={log.id}
                        style={[
                          styles.medicationItem,
                          index === arr.length - 1 && styles.medicationItemLast,
                        ]}
                      >
                        <View style={styles.timeColumn}>
                          <Text style={styles.medTime}>
                            {log.takenAt?.toDate
                              ? formatTime12h(
                                  log.takenAt
                                    .toDate()
                                    .toTimeString()
                                    .slice(0, 5),
                                )
                              : "--"}
                          </Text>
                        </View>
                        <View style={styles.medInfo}>
                          <Text style={styles.medName}>{log.name}</Text>
                          <Text style={styles.medDosage}>
                            {(() => {
                              const medication = medications.find(
                                (m) => m.id === log.medicationId,
                              );
                              return medication
                                ? getDosageDisplay(medication)
                                : log.dosageAmount
                                  ? `${log.dosageAmount} ${log.dosageUnit || "mg"}`
                                  : log.dosageAmount != null
                                    ? `${log.dosageAmount} ${log.dosageUnit || "mg"}`
                                    : "—";
                            })()}
                          </Text>
                        </View>
                        <View style={styles.takenBadge}>
                          <Ionicons
                            name="checkmark"
                            size={12}
                            color={Colors.success}
                          />
                          <Text style={styles.takenBadgeText}>Taken</Text>
                        </View>
                        {/* Delete Button */}
                        <TouchableOpacity
                          style={styles.deleteButton}
                          onPress={() => {
                            Alert.alert(
                              "Delete Log",
                              "Remove this dose from your history?",
                              [
                                { text: "Cancel", style: "cancel" },
                                {
                                  text: "Delete",
                                  style: "destructive",
                                  onPress: async () => {
                                    const targetUserId =
                                      userType === "caregiver"
                                        ? selectedPatientId
                                        : auth.currentUser?.uid;
                                    if (targetUserId) {
                                      await deleteDoc(
                                        doc(
                                          db,
                                          "users",
                                          targetUserId,
                                          "taken_logs",
                                          log.id,
                                        ),
                                      );
                                    }
                                  },
                                },
                              ],
                            );
                          }}
                        >
                          <Ionicons
                            name="ellipsis-vertical"
                            size={16}
                            color={Colors.textTertiary}
                          />
                        </TouchableOpacity>
                      </View>
                    ))}
                </View>
              </>
            )}
            {/* TEST ALARM BUTTON - Enhanced with Logging */}
            <TouchableOpacity
              style={styles.testAlarmButton}
              onPress={async () => {
                try {
                  const targetUserId =
                    userType === "caregiver"
                      ? selectedPatientId
                      : auth.currentUser?.uid;

                  if (!targetUserId) {
                    Alert.alert("Error", "No user selected");
                    return;
                  }

                  console.log("=== TEST ALARM START ===");
                  console.log("Target User ID:", targetUserId);

                  // Cancel any existing test alarms
                  console.log("Cancelling existing test alarms...");
                  await cancelMedicationAlarm(`${targetUserId}_test_alarm`);

                  // Replace your test button scheduling with this:
                  const now = new Date();
                  const testTime = new Date(now.getTime() + 2 * 60 * 1000); // 2 minutes from now
                  const hour = testTime.getHours();
                  const minute = testTime.getMinutes();
                  const timeString = `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;

                  console.log(
                    `⏰ Scheduling for ${timeString} — wait 2 minutes`,
                  );

                  const testReminderId = `${targetUserId}_test_alarm_${Date.now()}`;

                  console.log(
                    `📱 Scheduling test alarm at ${hour}:${minute} (${timeString})`,
                  );
                  console.log(`Current time: ${now.toLocaleTimeString()}`);
                  console.log(
                    `Alarm will fire at: ${testTime.toLocaleTimeString()}`,
                  );
                  console.log(`Reminder ID: ${testReminderId}`);

                  // Call scheduleMedicationAlarm
                  await scheduleMedicationAlarm(
                    testReminderId,
                    "🧪 TEST MEDICATION",
                    "500mg",
                    [timeString],
                    [], // Empty array = one-time alarm
                  );

                  console.log(
                    "✅ scheduleMedicationAlarm completed successfully",
                  );
                  console.log("=== TEST ALARM END ===");

                  Alert.alert(
                    "✅ Test Alarm Scheduled",
                    `Alarm scheduled for ${timeString} (in 15 seconds)\n\n` +
                      `Check the console for details.\n\n` +
                      `⚠️ Keep app open and screen on!`,
                    [{ text: "OK" }],
                  );
                } catch (error: any) {
                  console.error("❌ Test alarm error:", error);
                  Alert.alert(
                    "❌ Error",
                    error.message || "Failed to schedule test alarm",
                  );
                }
              }}
            >
              <Ionicons name="alarm" size={16} color={Colors.error} />
              <Text style={[styles.testAlarmText, { color: Colors.error }]}>
                🔔 Test Alarm (15s)
              </Text>
            </TouchableOpacity>

            {/* Log a Dose chips */}
            {canTakeOnSelectedDate &&
              medications.filter((m) => m.active).length > 0 && (
                <>
                  <Text style={styles.sectionTitle}>Log a Dose</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.quickTakeScroll}
                  >
                    {medications
                      .filter((m) => m.active)
                      .map((med) => (
                        <TouchableOpacity
                          key={med.id}
                          style={[
                            styles.quickTakeChip,
                            !safeCan.markAsTaken() && styles.disabledChip,
                          ]}
                          onPress={() =>
                            safeCan.markAsTaken() && openQuickTake(med)
                          }
                          disabled={!safeCan.markAsTaken()}
                        >
                          <Ionicons
                            name="medical"
                            size={14}
                            color={
                              !safeCan.markAsTaken()
                                ? Colors.textTertiary
                                : Colors.primary
                            }
                          />
                          <Text
                            style={[
                              styles.quickTakeChipText,
                              !safeCan.markAsTaken() && {
                                color: Colors.textTertiary,
                              },
                            ]}
                            numberOfLines={1}
                          >
                            {med.name}
                          </Text>
                        </TouchableOpacity>
                      ))}
                  </ScrollView>
                </>
              )}
            <View style={{ height: 100 }} />
          </View>
        </ScrollView>

        {/* Quick Take Modal */}
        <Modal
          animationType="slide"
          transparent
          visible={quickTakeVisible}
          onRequestClose={closeQuickTake}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={{ flex: 1 }}
          >
            <View style={styles.modalContainer}>
              <View
                style={[
                  styles.modalContent,
                  { paddingBottom: insets.bottom + 16 },
                ]}
              >
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Log a Dose</Text>
                  <TouchableOpacity onPress={closeQuickTake}>
                    <Ionicons name="close" size={24} color={Colors.text} />
                  </TouchableOpacity>
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.label}>Medication</Text>
                  <TextInput
                    style={styles.input}
                    value={quickTakeForm.name}
                    onChangeText={handleQuickTakeSearch}
                    placeholder="Search brand or generic name..."
                    placeholderTextColor={Colors.textTertiary}
                  />
                  {quickTakeShowSuggestions && (
                    <View
                      style={[styles.suggestionsContainer, { maxHeight: 200 }]}
                    >
                      {quickTakeSearching ? (
                        <View style={styles.suggestionLoading}>
                          <ActivityIndicator
                            size="small"
                            color={Colors.primary}
                          />
                          <Text style={styles.suggestionLoadingText}>
                            Searching...
                          </Text>
                        </View>
                      ) : quickTakeSearch.length > 0 ? (
                        <ScrollView
                          scrollEnabled
                          keyboardShouldPersistTaps="handled"
                        >
                          {quickTakeSearch.map((item) => (
                            <TouchableOpacity
                              key={item.id}
                              style={styles.suggestionItem}
                              onPress={() => handleQuickTakeSelect(item)}
                            >
                              <View style={styles.suggestionRow}>
                                <View style={styles.suggestionTextContainer}>
                                  <Text style={styles.suggestionBrand}>
                                    {item.ph_brand}
                                  </Text>
                                  {!item.is_generic &&
                                    item.generic_name !== item.ph_brand && (
                                      <Text style={styles.suggestionGeneric}>
                                        {item.generic_name}
                                      </Text>
                                    )}
                                </View>
                                <View
                                  style={[
                                    styles.suggestionTypeBadge,
                                    item.is_generic &&
                                      styles.suggestionGenericBadge,
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.suggestionTypeText,
                                      item.is_generic &&
                                        styles.suggestionGenericTypeText,
                                    ]}
                                  >
                                    {item.is_generic ? "Generic" : "Brand"}
                                  </Text>
                                </View>
                              </View>
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      ) : (
                        <View style={styles.suggestionEmpty}>
                          <Text style={styles.suggestionEmptyText}>
                            No medicines found
                          </Text>
                        </View>
                      )}
                    </View>
                  )}
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.label}>Dosage</Text>

                  <View style={styles.formRow}>
                    {/* Amount Input */}
                    <TextInput
                      style={[styles.input, { flex: 1, marginRight: 8 }]}
                      value={quickTakeForm.dosageAmount?.toString()}
                      onChangeText={(text) =>
                        setQuickTakeForm({
                          ...quickTakeForm,
                          dosageAmount: parseInt(text) || 0,
                        })
                      }
                      placeholder="Amount"
                      placeholderTextColor={Colors.textTertiary}
                      keyboardType="numeric"
                    />

                    {/* Unit Input */}
                    <TextInput
                      style={[styles.input, styles.unitInput]}
                      value={quickTakeForm.dosageUnit || "mg"}
                      onChangeText={(text) => {
                        const cleaned = text.replace(/[^a-zA-Z]/g, "");
                        setQuickTakeForm({
                          ...quickTakeForm,
                          dosageUnit: cleaned || "mg",
                        });
                      }}
                      placeholder="mg"
                      placeholderTextColor={Colors.textTertiary}
                      maxLength={5}
                    />
                  </View>
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.label}>Time taken</Text>
                  <TextInput
                    style={styles.input}
                    value={quickTakeForm.time}
                    onChangeText={(t) =>
                      setQuickTakeForm((p) => ({ ...p, time: t }))
                    }
                    placeholder="HH:MM"
                    placeholderTextColor={Colors.textTertiary}
                    keyboardType="numbers-and-punctuation"
                  />
                </View>

                <View style={styles.modalFooter}>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.cancelButton]}
                    onPress={closeQuickTake}
                  >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.saveButton]}
                    onPress={submitQuickTake}
                  >
                    <Text style={styles.saveButtonText}>Log Dose</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </SafeAreaView>
    </View>
  );
}
// Styles
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  mainHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: Colors.primary,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: Colors.surface,
    letterSpacing: 1,
  },
  headerIcons: { flexDirection: "row", alignItems: "center" },
  iconButton: { marginLeft: 20, padding: 4 },
  scrollView: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  header: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 10,
    backgroundColor: Colors.primary,
  },
  headerTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  dateHeader: { flex: 1 },
  todayText: { fontSize: 26, fontWeight: "800", color: Colors.surface },
  fullDate: { fontSize: 14, color: Colors.primaryLight, marginTop: 4 },
  todayButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginTop: 4,
    borderWidth: 1,
  },
  todayButtonActive: {
    backgroundColor: Colors.surface,
    borderColor: Colors.surface,
  },
  todayButtonInactive: {
    backgroundColor: "transparent",
    borderColor: Colors.surface,
  },
  todayButtonText: { fontWeight: "600", marginLeft: 6, fontSize: 14 },
  todayButtonTextActive: { color: Colors.primary },
  todayButtonTextInactive: { color: Colors.surface },
  calendarContainer: {
    backgroundColor: Colors.primary,
    paddingBottom: 15,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 15,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  calendarContent: { paddingVertical: 0 },
  dayContainer: {
    width: DAY_WIDTH,
    alignItems: "center",
    paddingVertical: 8,
    marginHorizontal: 2,
    borderRadius: 10,
  },
  todayContainer: { backgroundColor: Colors.todayHighlight },
  selectedContainer: { backgroundColor: Colors.selectedHighlight },
  dayName: {
    fontSize: 12,
    color: "rgba(255,255,255,0.8)",
    fontWeight: "500",
    marginBottom: 2,
  },
  dayNumber: { fontSize: 18, fontWeight: "600", color: Colors.surface },
  todayDayText: { color: Colors.surface },
  selectedText: { color: Colors.primary },
  reminderDot: { width: 5, height: 5, borderRadius: 3, marginTop: 3 },
  content: { paddingTop: 10 },
  selectedDateContainer: {
    paddingHorizontal: 20,
    marginBottom: 10,
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  selectedDateTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: Colors.text,
    flex: 1,
  },
  futureBadge: {
    backgroundColor: Colors.primary + "15",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  futureBadgeText: { fontSize: 11, color: Colors.primary, fontWeight: "600" },
  pastBadge: {
    backgroundColor: Colors.textTertiary + "20",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  pastBadgeText: {
    fontSize: 11,
    color: Colors.textTertiary,
    fontWeight: "600",
  },
  interactionBanner: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 12,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  severeBanner: {
    backgroundColor: Colors.error + "12",
    borderWidth: 1,
    borderColor: Colors.error + "30",
  },
  mildBanner: {
    backgroundColor: Colors.warning + "12",
    borderWidth: 1,
    borderColor: Colors.warning + "30",
  },
  bannerText: { flex: 1 },
  bannerTitle: { fontSize: 14, fontWeight: "700" },
  bannerSubtitle: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  loadingCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    padding: 24,
    alignItems: "center",
    gap: 10,
  },
  loadingText: { fontSize: 14, color: Colors.textSecondary },
  medicationsCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    padding: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  medicationItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 10,
  },
  medicationItemLast: { borderBottomWidth: 0 },
  medicationItemMissed: { backgroundColor: Colors.error + "06" },
  timeColumn: { width: 64, alignItems: "flex-start" },
  medTime: { fontSize: 12, fontWeight: "600", color: Colors.primary },
  medTimeMissed: { color: Colors.textTertiary },
  medInfo: { flex: 1 },
  medNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  medName: { fontSize: 13, fontWeight: "600", color: Colors.text },
  medNameMissed: { color: Colors.textSecondary },
  medDosage: { fontSize: 10, color: Colors.textSecondary, marginTop: 1 },
  medDosageMissed: { color: Colors.textTertiary },
  takenBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: Colors.success + "15",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  takenBadgeText: { fontSize: 10, color: Colors.success, fontWeight: "600" },
  missedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: Colors.error + "15",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  missedBadgeText: { fontSize: 10, color: Colors.error, fontWeight: "600" },
  lateBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: Colors.warning + "15",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  lateBadgeText: { fontSize: 10, color: Colors.warning, fontWeight: "600" },
  tagRow: { flexDirection: "row", gap: 6, marginTop: 4, flexWrap: "wrap" },
  interactionTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  severeTag: { backgroundColor: Colors.error + "15" },
  mildTag: { backgroundColor: Colors.warning + "15" },
  tagText: { fontSize: 11, fontWeight: "600" },
  takeButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: Colors.primary + "15",
    borderRadius: 20,
  },
  takenButton: { backgroundColor: Colors.success + "20" },
  takeButtonText: { color: Colors.primary, fontWeight: "600", fontSize: 10 },
  takenButtonText: { color: Colors.success },
  pastTakenBadge: { padding: 4 },
  futureIcon: { padding: 4 },
  noMedicationsCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    padding: 40,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  noMedicationsText: {
    fontSize: 13,
    color: Colors.textTertiary,
    textAlign: "center",
    marginTop: 16,
    lineHeight: 22,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: Colors.text,
    marginHorizontal: 16,
    marginBottom: 12,
    marginTop: 4,
  },
  actionsContainer: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  actionButton: { alignItems: "center" },
  actionIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
  },
  actionText: { fontSize: 12, color: Colors.text, textAlign: "center" },
  quickTakeScroll: { paddingHorizontal: 16, paddingBottom: 16, gap: 8 },
  quickTakeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.primary + "40",
    backgroundColor: Colors.primary + "08",
  },
  quickTakeChipText: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: "500",
    maxWidth: 100,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: { fontSize: 20, fontWeight: "bold", color: Colors.text },
  formGroup: { marginBottom: 16 },
  label: {
    fontSize: 14,
    fontWeight: "500",
    color: Colors.text,
    marginBottom: 6,
  },
  input: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    color: Colors.text,
  },
  modalFooter: { flexDirection: "row", gap: 12, marginTop: 8 },
  modalButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  cancelButton: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  saveButton: { backgroundColor: Colors.primary },
  cancelButtonText: { color: Colors.text, fontSize: 16, fontWeight: "600" },
  saveButtonText: { color: Colors.surface, fontSize: 16, fontWeight: "600" },
  suggestionsContainer: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    marginTop: 4,
    overflow: "hidden",
  },
  suggestionItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  suggestionTextContainer: { flex: 1, marginRight: 8 },
  suggestionBrand: { fontSize: 15, fontWeight: "600", color: Colors.text },
  suggestionGeneric: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  suggestionTypeBadge: {
    backgroundColor: Colors.primary + "15",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  suggestionGenericBadge: { backgroundColor: Colors.success + "15" },
  suggestionTypeText: {
    fontSize: 11,
    color: Colors.primary,
    fontWeight: "600",
  },
  suggestionGenericTypeText: { color: Colors.success },
  suggestionLoading: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 8,
  },
  suggestionLoadingText: { fontSize: 14, color: Colors.textSecondary },
  suggestionEmpty: { padding: 12 },
  suggestionEmptyText: { fontSize: 14, color: Colors.textSecondary },
  patientSelectorContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: Colors.primary,
    borderBottomColor: Colors.border,
  },
  patientSelectorLabel: {
    fontSize: 14,
    color: Colors.background,
    marginRight: 8,
    fontWeight: "500",
  },
  patientSelectorButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: Colors.background,
    borderRadius: 8,
  },
  patientSelectorText: {
    fontSize: 14,
    fontWeight: "800",
    color: Colors.primary,
  },
  patientDropdown: {
    position: "absolute",
    top: 50,
    left: 20,
    right: 20,
    backgroundColor: Colors.surface,
    borderRadius: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
    zIndex: 1000,
  },
  patientDropdownItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  patientDropdownText: {
    fontSize: 14,
    color: Colors.text,
  },
  disabledButton: {
    opacity: 0.5,
    backgroundColor: Colors.textTertiary,
  },
  disabledChip: {
    opacity: 0.5,
    borderColor: Colors.textTertiary,
  },
  calendarTodayContainer: {
    borderWidth: 1.5,
    borderColor: Colors.primaryLight,
    borderRadius: 10,
  },

  calendarTodayText: {
    color: Colors.primary,
    fontWeight: "700",
  },
  unitInput: {
    width: 80,
    textAlign: "center",
  },
  formRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  deleteButton: {
    padding: 8,
    marginLeft: 4,
  },
  testAlarmButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.primary + "40",
    backgroundColor: Colors.primary + "08",
    alignSelf: "center",
    marginBottom: 16,
  },
  testAlarmText: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: "500",
  },
});
function cleanupPastSnapshots(targetUserId: any) {
  throw new Error("Function not implemented.");
}
