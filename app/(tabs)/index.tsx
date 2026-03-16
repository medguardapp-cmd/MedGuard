// app/(tabs)/index.tsx
import { Ionicons } from "@expo/vector-icons";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Colors from "../../constants/colors";
import { auth, db } from "../../lib/firebase";
import { checkAllInteractions } from "../../lib/supabase";

const { width } = Dimensions.get("window");
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
  time: string; // "HH:MM"
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

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FULL_DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

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

// ─────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────
export default function HomeScreen() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [refreshing, setRefreshing] = useState(false);

  // Firebase data
  const [medications, setMedications] = useState<Medication[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [takenMap, setTakenMap] = useState<Record<string, boolean>>({});

  // Interactions
  const [interactions, setInteractions] = useState<InteractionInfo[]>([]);
  const [loadingInteractions, setLoadingInteractions] = useState(false);
  const [interactionsLoaded, setInteractionsLoaded] = useState(false);

  // Schedule for selected date
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);

  const scrollViewRef = useRef<ScrollView>(null);
  const today = new Date();
  const isTodaySelected = selectedDate.toDateString() === today.toDateString();

  // ─── Generate calendar days ───────────────────
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

  // ─── Auto-scroll to today ─────────────────────
  useEffect(() => {
    const timer = setTimeout(() => scrollToToday(), 100);
    return () => clearTimeout(timer);
  }, []);

  // ─── Firebase: Load medications + reminders ───
  useEffect(() => {
    const userId = auth.currentUser?.uid;
    if (!userId) return;

    const unsubMeds = onSnapshot(
      query(
        collection(db, "users", userId, "medications"),
        orderBy("createdAt", "desc"),
      ),
      (snap) => {
        const meds = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as Medication[];
        setMedications(meds);
        setInteractionsLoaded(false); // re-check interactions when meds change
      },
    );

    const unsubReminders = onSnapshot(
      collection(db, "users", userId, "reminders"),
      (snap) => {
        const rems = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as Reminder[];
        setReminders(rems);
      },
    );

    return () => {
      unsubMeds();
      unsubReminders();
    };
  }, []);

  // ─── Load interactions once meds are ready ────
  useEffect(() => {
    if (!interactionsLoaded && medications.length > 0) {
      loadInteractions();
    }
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

    // Deduplicate pairs
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

  // ─── Build schedule for selected date ─────────
  useEffect(() => {
    buildSchedule(selectedDate);
  }, [selectedDate, reminders, medications, interactions, takenMap]);

  const buildSchedule = (date: Date) => {
    const dayName = DAY_NAMES[date.getDay()]; // e.g. "Mon"
    const isPast = date < new Date(today.toDateString());
    const isFuture = date > new Date(today.toDateString());

    // Get reminders that fire on this day
    const getOneTimeDate = (r: Reminder) => {
      const now = new Date();
      const [hours, minutes] = r.time.split(":").map(Number);
      const candidate = new Date();
      candidate.setHours(hours, minutes, 0, 0);
      // If time has already passed today, it fires tomorrow
      if (candidate <= now) candidate.setDate(candidate.getDate() + 1);
      return candidate;
    };

    const dayReminders = reminders.filter((r) => {
      if (!r.enabled) return false;
      if (!r.days || r.days.length === 0) {
        // One-time: only show on its scheduled fire date
        const fireDate = getOneTimeDate(r);
        return fireDate.toDateString() === date.toDateString();
      }
      return r.days.includes(dayName);
    });

    const items: ScheduleItem[] = dayReminders.map((r) => {
      const med = medications.find((m) => m.id === r.medicationId);

      // Check if this med has interactions with other meds on the same day
      const sameDayMedIds = dayReminders
        .filter((dr) => dr.medicationId !== r.medicationId)
        .map((dr) => medications.find((m) => m.id === dr.medicationId)?.drug_id)
        .filter(Boolean) as string[];

      const medInteractions = interactions.filter(
        (i) =>
          (i.drug_id === med?.drug_id &&
            sameDayMedIds.includes(i.interacts_with)) ||
          (i.interacts_with === med?.drug_id &&
            sameDayMedIds.includes(i.drug_id)),
      );

      const hasSevere = medInteractions.some(
        (i) => getInteractionSeverity(i.description) === "severe",
      );

      return {
        reminderId: r.id,
        medicationId: r.medicationId,
        name: r.medicationName,
        dosage: r.medicationDosage,
        time: r.time,
        taken: isPast
          ? true
          : takenMap[`${date.toDateString()}-${r.id}`] || false,
        hasInteraction: medInteractions.length > 0,
        interactionSeverity:
          medInteractions.length > 0 ? (hasSevere ? "severe" : "mild") : null,
        interactionCount: medInteractions.length,
      };
    });

    // Sort by time
    items.sort((a, b) => a.time.localeCompare(b.time));
    setSchedule(items);
  };

  const toggleTaken = async (reminderId: string) => {
    const key = `${selectedDate.toDateString()}-${reminderId}`;
    const nowTaken = !takenMap[key];
    setTakenMap((prev) => ({ ...prev, [key]: nowTaken }));

    // Auto-disable one-time reminders when marked taken
    if (nowTaken) {
      const reminder = reminders.find((r) => r.id === reminderId);
      if (reminder && (!reminder.days || reminder.days.length === 0)) {
        const userId = auth.currentUser?.uid;
        if (userId) {
          await updateDoc(doc(db, "users", userId, "reminders", reminderId), {
            enabled: false,
          });
        }
      }
    }
  };

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
    setTakenMap({});
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
    if (isPast(date)) return `${formatDate(date)}`;
    return `Upcoming — ${formatDate(date)}`;
  };

  // ─── Interaction summary for header ───────────
  const severeCount = interactions.filter(
    (i) => getInteractionSeverity(i.description) === "severe",
  ).length;
  const mildCount = interactions.length - severeCount;

  // ─── Render ───────────────────────────────────
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
                color={isTodaySelected ? Colors.primary : Colors.textTertiary}
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
              // Show dot if there are reminders on this day
              const dayName = DAY_NAMES[date.getDay()];
              const hasReminders = reminders.some(
                (r) => r.enabled && r.days.includes(dayName),
              );
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
                  {hasReminders && (
                    <View
                      style={[
                        styles.reminderDot,
                        isSelected(date) && styles.reminderDotSelected,
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
            {isPast(selectedDate) && !isToday(selectedDate) && (
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
                  key={item.reminderId}
                  style={[
                    styles.medicationItem,
                    index === schedule.length - 1 && styles.medicationItemLast,
                  ]}
                >
                  {/* Time column */}
                  <View style={styles.timeColumn}>
                    <Text style={styles.medTime}>
                      {formatTime12h(item.time)}
                    </Text>
                  </View>

                  {/* Info column */}
                  <View style={styles.medInfo}>
                    <View style={styles.medNameRow}>
                      <Text style={styles.medName}>{item.name}</Text>
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
                    </View>
                    <Text style={styles.medDosage}>{item.dosage}</Text>

                    {/* Interaction tags */}
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

                  {/* Take button — only for today */}
                  {isToday(selectedDate) && (
                    <TouchableOpacity
                      style={[
                        styles.takeButton,
                        item.taken && styles.takenButton,
                      ]}
                      onPress={() => toggleTaken(item.reminderId)}
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

                  {/* Past — show as taken */}
                  {isPast(selectedDate) && (
                    <View style={styles.pastTakenBadge}>
                      <Ionicons
                        name="checkmark-circle"
                        size={20}
                        color={Colors.success}
                      />
                    </View>
                  )}

                  {/* Future — show clock */}
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
                {isFuture(selectedDate)
                  ? "No medications scheduled for this day"
                  : isToday(selectedDate)
                    ? "No medications scheduled for today"
                    : "No medications were scheduled for this day"}
              </Text>
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
                <Ionicons name="scan" size={28} color={Colors.surface} />
              </View>
              <Text style={styles.actionText}>Scan</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton}>
              <View
                style={[
                  styles.actionIcon,
                  { backgroundColor: Colors.accentDark },
                ]}
              >
                <Ionicons name="chatbubble" size={28} color={Colors.text} />
              </View>
              <Text style={styles.actionText}>Ask AI</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton}>
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

          <View style={{ height: 20 }} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

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
  reminderDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.7)",
    marginTop: 3,
  },
  reminderDotSelected: { backgroundColor: Colors.primary },
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

  // Interaction banner
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

  // Schedule card
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
  timeColumn: { width: 64, alignItems: "flex-start" },
  medTime: { fontSize: 13, fontWeight: "600", color: Colors.primary },
  medInfo: { flex: 1 },
  medNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  medName: { fontSize: 15, fontWeight: "600", color: Colors.text },
  medDosage: { fontSize: 13, color: Colors.textSecondary, marginTop: 1 },
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

  // Quick actions
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: Colors.text,
    marginHorizontal: 16,
    marginBottom: 12,
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
  actionText: { fontSize: 12, color: Colors.text },
});
