// app/(tabs)/index.tsx
import { Ionicons } from "@expo/vector-icons";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Colors from "../../constants/colors";
import { auth, db } from "../../lib/firebase";
import {
  backfillTodaySnapshot,
  SnapshotItem,
  snapshotKey,
} from "../../lib/scheduleSnapshot";
import { checkAllInteractions } from "../../lib/supabase";

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
  dosage: string;
  active: boolean;
  is_combination: boolean;
  ingredients: string[];
}

interface Reminder {
  id: string;
  medicationId: string;
  medicationName: string;
  medicationDosage: string;
  time: string;
  days: string[];
  enabled: boolean;
}

interface ScheduleItem {
  reminderId: string;
  medicationId: string;
  name: string;
  dosage: string;
  time: string;
  taken: boolean;
  missed: boolean;
  takenLogId?: string;
  hasInteraction: boolean;
  interactionSeverity: "mild" | "severe" | null;
  interactionCount: number;
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
  dosage: string;
  takenAt: any;
  dateKey: string;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

function dateKey(date: Date): string {
  return date.toDateString();
}

// ─────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────
export default function HomeScreen() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [refreshing, setRefreshing] = useState(false);

  const [medications, setMedications] = useState<Medication[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [takenLogs, setTakenLogs] = useState<TakenLog[]>([]);

  // snapshots cache: { "2026-01-15": SnapshotItem[] }
  const [snapshots, setSnapshots] = useState<Record<string, SnapshotItem[]>>(
    {},
  );

  const [interactions, setInteractions] = useState<InteractionInfo[]>([]);
  const [loadingInteractions, setLoadingInteractions] = useState(false);
  const [interactionsLoaded, setInteractionsLoaded] = useState(false);

  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);

  const [quickTakeVisible, setQuickTakeVisible] = useState(false);
  const [quickTakeForm, setQuickTakeForm] = useState({
    medicationId: "",
    name: "",
    dosage: "",
    time: "",
  });

  const scrollViewRef = useRef<ScrollView>(null);
  const backfillDone = useRef(false);
  const today = new Date();
  const isTodaySelected = selectedDate.toDateString() === today.toDateString();

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

  useEffect(() => {
    const timer = setTimeout(() => scrollToToday(), 100);
    return () => clearTimeout(timer);
  }, []);

  // ─── Firebase listeners ───────────────────────
  useEffect(() => {
    const userId = auth.currentUser?.uid;
    if (!userId) return;

    const unsubMeds = onSnapshot(
      query(
        collection(db, "users", userId, "medications"),
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
      collection(db, "users", userId, "reminders"),
      (snap) => {
        setReminders(
          snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Reminder[],
        );
      },
    );

    const unsubTaken = onSnapshot(
      collection(db, "users", userId, "taken_logs"),
      (snap) => {
        setTakenLogs(
          snap.docs.map((d) => ({ id: d.id, ...d.data() })) as TakenLog[],
        );
      },
    );

    // Load snapshots for past 15 days into local cache
    const loadSnapshots = async () => {
      const cache: Record<string, SnapshotItem[]> = {};
      await Promise.all(
        Array.from({ length: 15 }, (_, i) => {
          const d = new Date(today);
          d.setDate(today.getDate() - (i + 1));
          const sk = snapshotKey(d);
          return getDoc(
            doc(db, "users", userId, "schedule_snapshots", sk),
          ).then((snap) => {
            if (snap.exists()) cache[sk] = snap.data()?.items ?? [];
          });
        }),
      );
      setSnapshots(cache);
    };
    loadSnapshots();

    return () => {
      unsubMeds();
      unsubReminders();
      unsubTaken();
    };
  }, []);

  // ─── One-time backfill for today ──────────────
  useEffect(() => {
    if (backfillDone.current || reminders.length === 0) return;
    const userId = auth.currentUser?.uid;
    if (!userId) return;
    backfillDone.current = true;
    backfillTodaySnapshot(userId, reminders, today).catch(console.warn);
  }, [reminders]);

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
    snapshots,
  ]);

  const buildSchedule = (date: Date) => {
    const dk = dateKey(date);
    const sk = snapshotKey(date);
    const dayName = DAY_NAMES[date.getDay()];
    const isPastDay = date < new Date(today.toDateString());
    const isTodayDay = date.toDateString() === today.toDateString();
    const logsForDate = takenLogs.filter((l) => l.dateKey === dk);

    if (isPastDay) {
      // ── Past: build from snapshot, cross-reference taken_logs ──
      const snapshotItems = snapshots[sk] ?? [];

      const scheduledItems: ScheduleItem[] = snapshotItems.map((s) => {
        const takenLog = logsForDate.find((l) => l.reminderId === s.reminderId);
        return {
          reminderId: s.reminderId,
          medicationId: s.medicationId,
          name: s.name,
          dosage: s.dosage,
          time: s.time,
          taken: !!takenLog,
          missed: !takenLog,
          takenLogId: takenLog?.id,
          hasInteraction: false,
          interactionSeverity: null,
          interactionCount: 0,
        };
      });

      // Also show quick-takes that aren't in the snapshot
      const quickTakes: ScheduleItem[] = logsForDate
        .filter((l) => l.reminderId === "quick-take")
        .map((l) => ({
          reminderId: l.id,
          medicationId: l.medicationId,
          name: l.name,
          dosage: l.dosage,
          time: l.takenAt?.toDate
            ? l.takenAt.toDate().toTimeString().slice(0, 5)
            : "00:00",
          taken: true,
          missed: false,
          takenLogId: l.id,
          hasInteraction: false,
          interactionSeverity: null,
          interactionCount: 0,
        }));

      const all = [...scheduledItems, ...quickTakes];
      all.sort((a, b) => a.time.localeCompare(b.time));
      setSchedule(all);
      return;
    }

    // ── Today / Future: use live reminders ──
    const dayReminders = reminders.filter((r) => {
      if (!r.enabled) return false;
      if (!r.days || r.days.length === 0) return isTodayDay;
      return r.days.includes(dayName);
    });

    const items: ScheduleItem[] = dayReminders.map((r) => {
      const med = medications.find((m) => m.id === r.medicationId);

      const sameDayDrugIds = dayReminders
        .filter((dr) => dr.medicationId !== r.medicationId)
        .map((dr) => medications.find((m) => m.id === dr.medicationId)?.drug_id)
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
      const takenLog = logsForDate.find((l) => l.reminderId === r.id);

      return {
        reminderId: r.id,
        medicationId: r.medicationId,
        name: r.medicationName,
        dosage: r.medicationDosage,
        time: r.time,
        taken: !!takenLog,
        missed: false,
        takenLogId: takenLog?.id,
        hasInteraction: medInteractions.length > 0,
        interactionSeverity:
          medInteractions.length > 0 ? (hasSevere ? "severe" : "mild") : null,
        interactionCount: medInteractions.length,
      };
    });

    items.sort((a, b) => a.time.localeCompare(b.time));
    setSchedule(items);
  };

  // ─── Toggle taken ─────────────────────────────
  const toggleTaken = async (item: ScheduleItem) => {
    const userId = auth.currentUser?.uid;
    if (!userId) return;

    if (item.taken && item.takenLogId) {
      Alert.alert(
        "Undo taken?",
        "This will mark this medication as not taken.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Undo",
            style: "destructive",
            onPress: async () => {
              await deleteDoc(
                doc(db, "users", userId, "taken_logs", item.takenLogId!),
              );
            },
          },
        ],
      );
      return;
    }

    try {
      await addDoc(collection(db, "users", userId, "taken_logs"), {
        medicationId: item.medicationId,
        reminderId: item.reminderId,
        name: item.name,
        dosage: item.dosage,
        takenAt: serverTimestamp(),
        dateKey: dateKey(selectedDate),
      });

      const reminder = reminders.find((r) => r.id === item.reminderId);
      if (reminder && (!reminder.days || reminder.days.length === 0)) {
        await updateDoc(
          doc(db, "users", userId, "reminders", item.reminderId),
          {
            enabled: false,
          },
        );
      }
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to mark as taken");
    }
  };

  // ─── Quick Take ───────────────────────────────
  const openQuickTake = (med?: Medication) => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    setQuickTakeForm({
      medicationId: med?.id ?? "",
      name: med?.name ?? "",
      dosage: med?.dosage ?? "",
      time: `${hh}:${mm}`,
    });
    setQuickTakeVisible(true);
  };

  const submitQuickTake = async () => {
    if (!quickTakeForm.name.trim()) {
      Alert.alert("Error", "Please enter a medication name");
      return;
    }
    const userId = auth.currentUser?.uid;
    if (!userId) return;
    try {
      await addDoc(collection(db, "users", userId, "taken_logs"), {
        medicationId: quickTakeForm.medicationId || null,
        reminderId: "quick-take",
        name: quickTakeForm.name.trim(),
        dosage: quickTakeForm.dosage.trim(),
        takenAt: serverTimestamp(),
        dateKey: dateKey(selectedDate),
      });
      setQuickTakeVisible(false);
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to log");
    }
  };

  // ─── Navigation ───────────────────────────────
  const scrollToToday = () => {
    const todayIndex = days.findIndex(
      (d) => d.toDateString() === today.toDateString(),
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

  // ─── Calendar helpers ─────────────────────────
  const isToday = (d: Date) => d.toDateString() === today.toDateString();
  const isSelected = (d: Date) =>
    d.toDateString() === selectedDate.toDateString();
  const isPast = (d: Date) => d < new Date(today.toDateString());
  const isFuture = (d: Date) => d > new Date(today.toDateString());

  const formatDate = (date: Date) =>
    date.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

  const getDayLabel = (date: Date) => {
    if (isToday(date)) return "Today's Medications";
    if (isPast(date)) return formatDate(date);
    return `Upcoming — ${formatDate(date)}`;
  };

  // Dot status per calendar day
  const getDotStatus = (date: Date): "none" | "grey" | "green" | "red" => {
    const dayName = DAY_NAMES[date.getDay()];

    if (isPast(date)) {
      const sk = snapshotKey(date);
      const snapshotItems = snapshots[sk] ?? [];
      if (snapshotItems.length === 0) return "none";
      const dk = dateKey(date);
      const logsForDate = takenLogs.filter((l) => l.dateKey === dk);
      const anyMissed = snapshotItems.some(
        (s) => !logsForDate.find((l) => l.reminderId === s.reminderId),
      );
      return anyMissed ? "red" : "green";
    }

    const hasScheduled = reminders.some(
      (r) =>
        r.enabled &&
        (r.days?.includes(dayName) ||
          ((!r.days || r.days.length === 0) && isToday(date))),
    );
    return hasScheduled ? "grey" : "none";
  };

  const dotColorValue = (status: ReturnType<typeof getDotStatus>) => {
    if (status === "green") return Colors.success;
    if (status === "red") return Colors.error;
    return "rgba(255,255,255,0.7)";
  };

  const severeCount = interactions.filter(
    (i) => getInteractionSeverity(i.description) === "severe",
  ).length;
  const mildCount = interactions.length - severeCount;

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      {/* Top Header */}
      <View style={styles.mainHeader}>
        <Text style={styles.headerTitle}>MEDGUARD</Text>
        <View style={styles.headerIcons}>
          <TouchableOpacity style={styles.iconButton}>
            <Ionicons
              name="notifications-outline"
              size={24}
              color={Colors.surface}
            />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconButton}>
            <Ionicons name="person-outline" size={24} color={Colors.surface} />
          </TouchableOpacity>
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
                    isToday(date) && styles.todayContainer,
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
          {interactions.length > 0 && (
            <View
              style={[
                styles.interactionBanner,
                severeCount > 0 ? styles.severeBanner : styles.mildBanner,
              ]}
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
                    { color: severeCount > 0 ? Colors.error : Colors.warning },
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
            </View>
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
                    index === schedule.length - 1 && styles.medicationItemLast,
                    item.missed && styles.medicationItemMissed,
                  ]}
                >
                  {/* Time */}
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

                  {/* Info */}
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
                    </View>
                    <Text
                      style={[
                        styles.medDosage,
                        item.missed && styles.medDosageMissed,
                      ]}
                    >
                      {item.dosage}
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

                  {/* Right side */}
                  {isTodaySelected && (
                    <TouchableOpacity
                      style={[
                        styles.takeButton,
                        item.taken && styles.takenButton,
                      ]}
                      onPress={() => toggleTaken(item)}
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
                  {isPast(selectedDate) && (
                    <View style={styles.pastTakenBadge}>
                      <Ionicons
                        name={item.taken ? "checkmark-circle" : "close-circle"}
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
              {isTodaySelected && (
                <TouchableOpacity
                  style={[
                    styles.takeButton,
                    { marginTop: 16, paddingHorizontal: 20 },
                  ]}
                  onPress={() => openQuickTake()}
                >
                  <Text style={styles.takeButtonText}>Log a dose</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Quick Actions */}
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.actionsContainer}>
            <TouchableOpacity style={styles.actionButton}>
              <View
                style={[styles.actionIcon, { backgroundColor: Colors.success }]}
              >
                <Ionicons name="add-circle" size={28} color={Colors.surface} />
              </View>
              <Text style={styles.actionText}>Add Med</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton}>
              <View
                style={[styles.actionIcon, { backgroundColor: Colors.warning }]}
              >
                <Ionicons name="clipboard" size={28} color={Colors.surface} />
              </View>
              <Text style={styles.actionText}>Log Reaction</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton}>
              <View
                style={[styles.actionIcon, { backgroundColor: Colors.primary }]}
              >
                <Ionicons name="alarm" size={28} color={Colors.surface} />
              </View>
              <Text style={styles.actionText}>Add Reminder</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() =>
                Alert.alert(
                  "🚨 Emergency",
                  "If this is a medical emergency, call emergency services immediately.\n\nEmergency: 911\nPoison Control: 1-800-222-1222",
                  [{ text: "OK" }],
                )
              }
            >
              <View
                style={[styles.actionIcon, { backgroundColor: Colors.error }]}
              >
                <Ionicons
                  name="alert-circle"
                  size={28}
                  color={Colors.surface}
                />
              </View>
              <Text style={styles.actionText}>SOS</Text>
            </TouchableOpacity>
          </View>

          {/* Log a Dose chips */}
          {isTodaySelected &&
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
                        style={styles.quickTakeChip}
                        onPress={() => openQuickTake(med)}
                      >
                        <Ionicons
                          name="medical"
                          size={14}
                          color={Colors.primary}
                        />
                        <Text
                          style={styles.quickTakeChipText}
                          numberOfLines={1}
                        >
                          {med.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  <TouchableOpacity
                    style={[styles.quickTakeChip, { borderStyle: "dashed" }]}
                    onPress={() => openQuickTake()}
                  >
                    <Ionicons
                      name="add"
                      size={14}
                      color={Colors.textSecondary}
                    />
                    <Text
                      style={[
                        styles.quickTakeChipText,
                        { color: Colors.textSecondary },
                      ]}
                    >
                      Other
                    </Text>
                  </TouchableOpacity>
                </ScrollView>
              </>
            )}

          <View style={{ height: 20 }} />
        </View>
      </ScrollView>

      {/* Quick Take Modal */}
      <Modal
        animationType="slide"
        transparent
        visible={quickTakeVisible}
        onRequestClose={() => setQuickTakeVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Log a Dose</Text>
              <TouchableOpacity onPress={() => setQuickTakeVisible(false)}>
                <Ionicons name="close" size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.formGroup}>
              <Text style={styles.label}>Medication</Text>
              <TextInput
                style={styles.input}
                value={quickTakeForm.name}
                onChangeText={(t) =>
                  setQuickTakeForm((p) => ({ ...p, name: t }))
                }
                placeholder="e.g. Paracetamol / Biogesic"
                placeholderTextColor={Colors.textTertiary}
              />
            </View>
            <View style={styles.formGroup}>
              <Text style={styles.label}>Dosage</Text>
              <TextInput
                style={styles.input}
                value={quickTakeForm.dosage}
                onChangeText={(t) =>
                  setQuickTakeForm((p) => ({ ...p, dosage: t }))
                }
                placeholder="e.g. 500mg, 1 tablet"
                placeholderTextColor={Colors.textTertiary}
              />
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
                onPress={() => setQuickTakeVisible(false)}
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
      </Modal>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────
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
  fullDate: { fontSize: 14, color: Colors.accent, marginTop: 4 },
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
  dayNumber: { fontSize: 18, fontWeight: "bold", color: Colors.surface },
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
    shadowRadius: 8,
    elevation: 4,
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
  medTime: { fontSize: 13, fontWeight: "600", color: Colors.primary },
  medTimeMissed: { color: Colors.textTertiary },
  medInfo: { flex: 1 },
  medNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  medName: { fontSize: 15, fontWeight: "600", color: Colors.text },
  medNameMissed: { color: Colors.textSecondary },
  medDosage: { fontSize: 13, color: Colors.textSecondary, marginTop: 1 },
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
  takenBadgeText: { fontSize: 11, color: Colors.success, fontWeight: "600" },
  missedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: Colors.error + "15",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  missedBadgeText: { fontSize: 11, color: Colors.error, fontWeight: "600" },
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
  takeButtonText: { color: Colors.primary, fontWeight: "600", fontSize: 14 },
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
    shadowRadius: 4,
    elevation: 2,
  },
  noMedicationsText: {
    fontSize: 15,
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
});
