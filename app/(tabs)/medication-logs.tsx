// app/(tabs)/medication-logs.tsx
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { auth, db } from "../../lib/firebase";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
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

interface TakenLog {
  id: string;
  medicationId: string;
  reminderId: string;
  name: string;
  dosage: string;
  takenAt: any;
  dateKey: string;
}

interface MissedLog {
  id: string;
  medicationId: string;
  reminderId: string;
  name: string;
  dosage: string;
  scheduledTime: string;
  dateKey: string;
  missedAt: any;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
const normalizeDate = (date: Date): Date => {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
};

const formatDateLabel = (dateString: string): string => {
  // dateString is a Date.toDateString() value, e.g. "Mon Apr 14 2026"
  const date = new Date(dateString);
  const today = normalizeDate(new Date());
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";

  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

const formatTime = (timestamp: any): string => {
  if (!timestamp) return "";
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatTime12h = (time: string): string => {
  if (!time) return "";
  const [hours, minutes] = time.split(":");
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
};

const getComplianceRate = (taken: number, missed: number): number => {
  const total = taken + missed;
  if (total === 0) return 100;
  return Math.round((taken / total) * 100);
};

// ─────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────
export default function MedicationLogsScreen() {
  const router = useRouter();
  const [reminderStatusLogs, setReminderStatusLogs] = useState<
    ReminderStatusLog[]
  >([]);
  const [takenLogs, setTakenLogs] = useState<TakenLog[]>([]);
  const [missedLogs, setMissedLogs] = useState<MissedLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<"all" | "taken" | "missed">(
    "all",
  );

  // Detail modal
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [logsModalVisible, setLogsModalVisible] = useState(false);

  // ─── Firebase listeners ───────────────────────
  useEffect(() => {
    const userId = auth.currentUser?.uid;
    if (!userId) {
      setLoading(false);
      return;
    }

    let statusReady = false;
    let takenReady = false;
    let missedReady = false;

    const checkReady = () => {
      if (statusReady && takenReady && missedReady) setLoading(false);
    };

    // Listen to reminder_status_logs (primary source)
    const unsubStatus = onSnapshot(
      query(
        collection(db, "users", userId, "reminder_status_logs"),
        orderBy("updatedAt", "desc"),
      ),
      (snap) => {
        setReminderStatusLogs(
          snap.docs.map((d) => ({
            id: d.id,
            ...d.data(),
          })) as ReminderStatusLog[],
        );
        statusReady = true;
        checkReady();
      },
    );

    // Keep taken_logs for backward compatibility and quick-takes
    const unsubTaken = onSnapshot(
      query(
        collection(db, "users", userId, "taken_logs"),
        orderBy("takenAt", "desc"),
      ),
      (snap) => {
        setTakenLogs(
          snap.docs.map((d) => ({ id: d.id, ...d.data() })) as TakenLog[],
        );
        takenReady = true;
        checkReady();
      },
    );

    const unsubMissed = onSnapshot(
      query(
        collection(db, "users", userId, "missed_logs"),
        orderBy("missedAt", "desc"),
      ),
      (snap) => {
        setMissedLogs(
          snap.docs.map((d) => ({ id: d.id, ...d.data() })) as MissedLog[],
        );
        missedReady = true;
        checkReady();
      },
    );

    return () => {
      unsubStatus();
      unsubTaken();
      unsubMissed();
    };
  }, []);

  // ─── Group logs by date from reminder_status_logs ───────────────────────
  const getLogsByDate = () => {
    const logsByDate: Record<
      string,
      {
        taken: ReminderStatusLog[];
        missed: ReminderStatusLog[];
        late: ReminderStatusLog[];
        notTaken: ReminderStatusLog[];
      }
    > = {};

    // Process reminder_status_logs
    reminderStatusLogs.forEach((log) => {
      if (!log.dateKey) return;
      if (!logsByDate[log.dateKey]) {
        logsByDate[log.dateKey] = {
          taken: [],
          missed: [],
          late: [],
          notTaken: [],
        };
      }

      if (log.status === "taken") {
        // Put late variance into 'late' array instead of 'taken'
        if (log.takenVariance === "late") {
          logsByDate[log.dateKey].late.push(log);
        } else {
          logsByDate[log.dateKey].taken.push(log);
        }
      } else if (log.status === "missed") {
        logsByDate[log.dateKey].missed.push(log);
      } else if (log.status === "late") {
        logsByDate[log.dateKey].late.push(log);
      } else if (log.status === "not-taken") {
        logsByDate[log.dateKey].notTaken.push(log);
      }
    });

    // Sort dates newest-first
    const sortedDates = Object.keys(logsByDate).sort(
      (a, b) => new Date(b).getTime() - new Date(a).getTime(),
    );

    return { logsByDate, sortedDates };
  };

  const { logsByDate, sortedDates } = getLogsByDate();

  const filteredDates = sortedDates.filter((dk) => {
    if (filterType === "all") return true;
    const { taken, missed, late } = logsByDate[dk];
    if (filterType === "taken") return taken.length > 0 || late.length > 0;
    if (filterType === "missed") return missed.length > 0;
    return true;
  });

  // ─── Overall stats ────────────────────────────
  const totalTaken = reminderStatusLogs.filter(
    (l) => l.status === "taken" || l.status === "late",
  ).length;
  const totalMissed = reminderStatusLogs.filter(
    (l) => l.status === "missed",
  ).length;
  const overallCompliance = getComplianceRate(totalTaken, totalMissed);

  // ─── Quick-take stats (from legacy taken_logs) ───
  const quickTakesCount = takenLogs.filter(
    (l) => l.reminderId === "quick-take",
  ).length;

  // ─── Detail modal data ────────────────────────
  const selectedLogs = selectedDate ? logsByDate[selectedDate] : null;

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.loadingText}>Loading medication history...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color="#0f172a" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Medication Logs</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Stats Summary */}
      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{overallCompliance}%</Text>
          <Text style={styles.statLabel}>Compliance</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: "#10b981" }]}>
            {totalTaken}
          </Text>
          <Text style={styles.statLabel}>Taken</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: "#ef4444" }]}>
            {totalMissed}
          </Text>
          <Text style={styles.statLabel}>Missed</Text>
        </View>
      </View>

      {/* Quick Takes Stats (optional) */}
      {quickTakesCount > 0 && (
        <View style={styles.quickTakeStats}>
          <Ionicons name="flash" size={16} color="#8b5cf6" />
          <Text style={styles.quickTakeStatsText}>
            {quickTakesCount} as-needed dose{quickTakesCount !== 1 ? "s" : ""}{" "}
            logged
          </Text>
        </View>
      )}

      {/* Filter Tabs */}
      <View style={styles.filterContainer}>
        {(["all", "taken", "missed"] as const).map((f) => (
          <TouchableOpacity
            key={f}
            style={[
              styles.filterTab,
              filterType === f && styles.filterTabActive,
            ]}
            onPress={() => setFilterType(f)}
          >
            <Text
              style={[
                styles.filterText,
                filterType === f && styles.filterTextActive,
              ]}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Logs List */}
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {filteredDates.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="calendar-outline" size={64} color="#cbd5e1" />
            <Text style={styles.emptyTitle}>No medication logs yet</Text>
            <Text style={styles.emptyText}>
              Start taking your medications to see your history here
            </Text>
          </View>
        ) : (
          filteredDates.map((dk) => {
            const { taken, missed, late, notTaken } = logsByDate[dk];

            // Get unique medication IDs for each status
            const uniqueTakenCount = new Set(
              [...taken, ...late].map((l) => l.medicationId),
            ).size;
            const uniqueMissedCount = new Set(missed.map((l) => l.medicationId))
              .size;
            const uniqueNotTakenCount = new Set(
              notTaken.map((l) => l.medicationId),
            ).size;

            const uniqueLateCount = new Set(late.map((l) => l.medicationId))
              .size;

            const totalScheduled =
              uniqueTakenCount +
              uniqueLateCount +
              uniqueMissedCount +
              uniqueNotTakenCount;
            const complianceRate =
              totalScheduled > 0
                ? getComplianceRate(uniqueTakenCount, uniqueMissedCount)
                : 100;
            const missedCount = missed.length;
            const notTakenCount = notTaken.length;

            return (
              <TouchableOpacity
                key={dk}
                style={styles.logCard}
                onPress={() => {
                  setSelectedDate(dk);
                  setLogsModalVisible(true);
                }}
              >
                <View style={styles.logCardHeader}>
                  <Text style={styles.logDate}>{formatDateLabel(dk)}</Text>
                  <View
                    style={[
                      styles.complianceBadge,
                      {
                        backgroundColor:
                          complianceRate >= 80
                            ? "#10b981"
                            : complianceRate >= 50
                              ? "#f59e0b"
                              : "#ef4444",
                      },
                    ]}
                  >
                    <Text style={styles.complianceText}>{complianceRate}%</Text>
                  </View>
                </View>

                <View style={styles.logStats}>
                  <View style={styles.statItem}>
                    <Ionicons
                      name="checkmark-circle"
                      size={18}
                      color="#10b981"
                    />
                    <Text style={styles.statItemText}>
                      {uniqueTakenCount} taken
                    </Text>
                  </View>
                  {/* {late.length > 0 && (
                    <View style={styles.statItem}>
                      <Ionicons name="time" size={18} color="#f59e0b" />
                      <Text style={[styles.statItemText, { color: "#f59e0b" }]}>
                        {uniqueLateCount} late
                      </Text>
                    </View>
                  )}
                  {uniqueMissedCount > 0 && (
                    <View style={styles.statItem}>
                      <Ionicons name="close-circle" size={18} color="#ef4444" />
                      <Text style={[styles.statItemText, styles.missedText]}>
                        {uniqueMissedCount} missed
                      </Text>
                    </View>
                  )} */}
                  <View style={styles.statItem}>
                    <Ionicons name="medical" size={18} color="#3b82f6" />
                    <Text style={styles.statItemText}>
                      {totalScheduled} scheduled
                    </Text>
                  </View>
                </View>

                <View style={styles.viewDetails}>
                  <Text style={styles.viewDetailsText}>
                    Tap to view details →
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Detail Modal */}
      <Modal
        animationType="slide"
        transparent={false}
        visible={logsModalVisible}
        onRequestClose={() => setLogsModalVisible(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setLogsModalVisible(false)}>
              <Ionicons name="arrow-back" size={24} color="#0f172a" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>
              {selectedDate ? formatDateLabel(selectedDate) : ""}
            </Text>
            <View style={{ width: 24 }} />
          </View>

          <ScrollView style={styles.modalContent}>
            {/* Taken Medications (including late) */}
            {selectedLogs &&
              (selectedLogs.taken.length > 0 ||
                selectedLogs.late.length > 0) && (
                <View style={styles.logSection}>
                  <View style={styles.logSectionHeader}>
                    <Ionicons
                      name="checkmark-circle"
                      size={22}
                      color="#10b981"
                    />
                    <Text style={styles.logSectionTitle}>
                      Taken Medications
                    </Text>
                    <Text style={styles.logSectionCount}>
                      {selectedLogs.taken.length + selectedLogs.late.length}
                    </Text>
                  </View>

                  {/* On-time taken */}
                  {selectedLogs.taken.map((log) => (
                    <View key={log.id} style={styles.detailCard}>
                      <View style={styles.detailCardHeader}>
                        <Text style={styles.detailMedName}>{log.name}</Text>
                        <View style={styles.takenBadge}>
                          <Ionicons
                            name="checkmark"
                            size={12}
                            color="#10b981"
                          />
                          <Text style={styles.takenBadgeText}>Taken</Text>
                          {log.takenVariance === "early" && (
                            <Text
                              style={[
                                styles.takenBadgeText,
                                { color: "#3b82f6" },
                              ]}
                            >
                              · Early
                            </Text>
                          )}
                        </View>
                      </View>
                      <Text style={styles.detailDosage}>{log.dosage}</Text>
                      <Text style={styles.detailTime}>
                        Taken at {formatTime(log.takenAt)} (scheduled{" "}
                        {formatTime12h(log.scheduledTime)})
                      </Text>
                    </View>
                  ))}

                  {/* Late taken */}
                  {selectedLogs.late.map((log) => (
                    <View
                      key={log.id}
                      style={[styles.detailCard, styles.lateCard]}
                    >
                      <View style={styles.detailCardHeader}>
                        <Text style={styles.detailMedName}>{log.name}</Text>
                        <View style={styles.lateBadge}>
                          <Ionicons name="time" size={12} color="#f59e0b" />
                          <Text style={styles.lateBadgeText}>Late</Text>
                        </View>
                      </View>
                      <Text style={styles.detailDosage}>{log.dosage}</Text>
                      <Text style={styles.detailTime}>
                        Taken at {formatTime(log.takenAt)} (scheduled{" "}
                        {formatTime12h(log.scheduledTime)})
                      </Text>
                    </View>
                  ))}
                </View>
              )}

            {/* Missed Medications */}
            {selectedLogs?.missed && selectedLogs.missed.length > 0 && (
              <View style={styles.logSection}>
                <View style={styles.logSectionHeader}>
                  <Ionicons name="close-circle" size={22} color="#ef4444" />
                  <Text style={styles.logSectionTitle}>Missed Medications</Text>
                  <Text style={styles.logSectionCount}>
                    {selectedLogs.missed.length}
                  </Text>
                </View>
                {selectedLogs.missed.map((item) => (
                  <View key={item.id} style={styles.detailCard}>
                    <View style={styles.detailCardHeader}>
                      <Text style={styles.detailMedName}>{item.name}</Text>
                      <View style={styles.missedBadge}>
                        <Ionicons name="close" size={12} color="#ef4444" />
                        <Text style={styles.missedBadgeText}>Missed</Text>
                      </View>
                    </View>
                    <Text style={styles.detailDosage}>{item.dosage}</Text>
                    <Text style={styles.detailTime}>
                      Scheduled at {formatTime12h(item.scheduledTime)}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* Not Taken (Still Pending) - only show for today/past dates with pending doses */}
            {selectedLogs?.notTaken && selectedLogs.notTaken.length > 0 && (
              <View style={styles.logSection}>
                <View style={styles.logSectionHeader}>
                  <Ionicons name="time-outline" size={22} color="#94a3b8" />
                  <Text style={styles.logSectionTitle}>Not Taken</Text>
                  <Text style={styles.logSectionCount}>
                    {selectedLogs.notTaken.length}
                  </Text>
                </View>
                {selectedLogs.notTaken.map((item) => (
                  <View key={item.id} style={styles.detailCard}>
                    <View style={styles.detailCardHeader}>
                      <Text style={styles.detailMedName}>{item.name}</Text>
                      <View style={styles.notTakenBadge}>
                        <Ionicons
                          name="time-outline"
                          size={12}
                          color="#94a3b8"
                        />
                        <Text style={styles.notTakenBadgeText}>Pending</Text>
                      </View>
                    </View>
                    <Text style={styles.detailDosage}>{item.dosage}</Text>
                    <Text style={styles.detailTime}>
                      Scheduled at {formatTime12h(item.scheduledTime)}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* As-Needed / Quick Takes from legacy logs */}
            {(() => {
              const quickTakesForDate = takenLogs.filter(
                (l) =>
                  l.dateKey === selectedDate && l.reminderId === "quick-take",
              );
              if (quickTakesForDate.length === 0) return null;
              return (
                <View style={styles.logSection}>
                  <View style={styles.logSectionHeader}>
                    <Ionicons name="flash" size={22} color="#8b5cf6" />
                    <Text style={styles.logSectionTitle}>As Needed</Text>
                    <Text style={styles.logSectionCount}>
                      {quickTakesForDate.length}
                    </Text>
                  </View>
                  {quickTakesForDate.map((log) => (
                    <View key={log.id} style={styles.detailCard}>
                      <View style={styles.detailCardHeader}>
                        <Text style={styles.detailMedName}>{log.name}</Text>
                        <View
                          style={[
                            styles.takenBadge,
                            { backgroundColor: "#ede9fe" },
                          ]}
                        >
                          <Ionicons name="flash" size={12} color="#8b5cf6" />
                          <Text
                            style={[
                              styles.takenBadgeText,
                              { color: "#8b5cf6" },
                            ]}
                          >
                            As Needed
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.detailDosage}>{log.dosage}</Text>
                      <Text style={styles.detailTime}>
                        Taken at {formatTime(log.takenAt)}
                      </Text>
                    </View>
                  ))}
                </View>
              );
            })()}

            {/* Summary Card */}
            {selectedLogs && (
              <View style={styles.summaryCard}>
                <Text style={styles.summaryTitle}>Daily Summary</Text>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Compliance Rate</Text>
                  <Text style={styles.summaryValue}>
                    {getComplianceRate(
                      selectedLogs.taken.length + selectedLogs.late.length,
                      selectedLogs.missed.length,
                    )}
                    %
                  </Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Scheduled Total</Text>
                  <Text style={styles.summaryValue}>
                    {selectedLogs.taken.length +
                      selectedLogs.late.length +
                      selectedLogs.missed.length +
                      selectedLogs.notTaken.length}
                  </Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Taken (On Time)</Text>
                  <Text style={[styles.summaryValue, { color: "#10b981" }]}>
                    {selectedLogs.taken.length}
                  </Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Taken (Late)</Text>
                  <Text style={[styles.summaryValue, { color: "#f59e0b" }]}>
                    {selectedLogs.late.length}
                  </Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Missed</Text>
                  <Text style={[styles.summaryValue, { color: "#ef4444" }]}>
                    {selectedLogs.missed.length}
                  </Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Not Taken</Text>
                  <Text style={[styles.summaryValue, { color: "#94a3b8" }]}>
                    {selectedLogs.notTaken.length}
                  </Text>
                </View>
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: "#64748b",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#0f172a",
  },
  statsContainer: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 16,
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  statValue: {
    fontSize: 24,
    fontWeight: "700",
    color: "#3b82f6",
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: "#64748b",
  },
  quickTakeStats: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: "#ede9fe",
    borderRadius: 20,
    alignSelf: "flex-start",
  },
  quickTakeStatsText: {
    fontSize: 12,
    color: "#8b5cf6",
    fontWeight: "500",
  },
  filterContainer: {
    flexDirection: "row",
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 16,
  },
  filterTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: 8,
    backgroundColor: "#f1f5f9",
  },
  filterTabActive: {
    backgroundColor: "#3b82f6",
  },
  filterText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#64748b",
  },
  filterTextActive: {
    color: "#ffffff",
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#0f172a",
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: "#64748b",
    textAlign: "center",
  },
  logCard: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  logCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  logDate: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0f172a",
  },
  complianceBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  complianceText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#ffffff",
  },
  logStats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 12,
  },
  statItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statItemText: {
    fontSize: 13,
    color: "#64748b",
  },
  missedText: {
    color: "#ef4444",
  },
  viewDetails: {
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingTop: 12,
    marginTop: 4,
  },
  viewDetailsText: {
    fontSize: 13,
    color: "#3b82f6",
  },
  modalContainer: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#0f172a",
  },
  modalContent: {
    padding: 16,
  },
  logSection: {
    marginBottom: 24,
  },
  logSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  logSectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0f172a",
    flex: 1,
  },
  logSectionCount: {
    fontSize: 14,
    fontWeight: "600",
    color: "#64748b",
    backgroundColor: "#f1f5f9",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  detailCard: {
    backgroundColor: "#ffffff",
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  lateCard: {
    backgroundColor: "#fef3c7",
    borderColor: "#fde68a",
  },
  detailCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  detailMedName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#0f172a",
    flex: 1,
  },
  takenBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#d1fae5",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  takenBadgeText: {
    fontSize: 11,
    color: "#10b981",
    fontWeight: "500",
  },
  lateBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#fed7aa",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  lateBadgeText: {
    fontSize: 11,
    color: "#f59e0b",
    fontWeight: "500",
  },
  missedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#fee2e2",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  missedBadgeText: {
    fontSize: 11,
    color: "#ef4444",
    fontWeight: "500",
  },
  notTakenBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#f1f5f9",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  notTakenBadgeText: {
    fontSize: 11,
    color: "#94a3b8",
    fontWeight: "500",
  },
  detailDosage: {
    fontSize: 13,
    color: "#64748b",
    marginBottom: 6,
  },
  detailTime: {
    fontSize: 12,
    color: "#94a3b8",
  },
  summaryCard: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
    marginBottom: 32,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0f172a",
    marginBottom: 12,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  summaryLabel: {
    fontSize: 14,
    color: "#64748b",
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0f172a",
  },
});
