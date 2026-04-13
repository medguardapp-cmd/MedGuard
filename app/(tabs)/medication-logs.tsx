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

    let takenReady = false;
    let missedReady = false;

    const checkReady = () => {
      if (takenReady && missedReady) setLoading(false);
    };

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
      unsubTaken();
      unsubMissed();
    };
  }, []);

  // ─── Group logs by date ───────────────────────
  const getLogsByDate = () => {
    const logsByDate: Record<
      string,
      { taken: TakenLog[]; missed: MissedLog[] }
    > = {};

    takenLogs.forEach((log) => {
      if (!log.dateKey) return;
      if (!logsByDate[log.dateKey])
        logsByDate[log.dateKey] = { taken: [], missed: [] };
      logsByDate[log.dateKey].taken.push(log);
    });

    missedLogs.forEach((log) => {
      if (!log.dateKey) return;
      if (!logsByDate[log.dateKey])
        logsByDate[log.dateKey] = { taken: [], missed: [] };
      logsByDate[log.dateKey].missed.push(log);
    });

    // Sort dates newest-first
    // dateKey is Date.toDateString() — parse with new Date()
    const sortedDates = Object.keys(logsByDate).sort(
      (a, b) => new Date(b).getTime() - new Date(a).getTime(),
    );

    return { logsByDate, sortedDates };
  };

  const { logsByDate, sortedDates } = getLogsByDate();

  const filteredDates = sortedDates.filter((dk) => {
    if (filterType === "all") return true;
    const { taken, missed } = logsByDate[dk];
    if (filterType === "taken") return taken.length > 0;
    if (filterType === "missed") return missed.length > 0;
    return true;
  });

  // ─── Overall stats ────────────────────────────
  const totalTaken = takenLogs.filter(
    (l) => l.reminderId !== "quick-take",
  ).length;
  const totalMissed = missedLogs.length;
  const overallCompliance = getComplianceRate(totalTaken, totalMissed);

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
            const { taken, missed } = logsByDate[dk];
            const scheduledTaken = taken.filter(
              (l) => l.reminderId !== "quick-take",
            );
            const quickTakes = taken.filter(
              (l) => l.reminderId === "quick-take",
            );
            const takenCount = scheduledTaken.length;
            const missedCount = missed.length;
            const complianceRate = getComplianceRate(takenCount, missedCount);

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
                    <Text style={styles.statItemText}>{takenCount} taken</Text>
                  </View>
                  {missedCount > 0 && (
                    <View style={styles.statItem}>
                      <Ionicons name="close-circle" size={18} color="#ef4444" />
                      <Text style={[styles.statItemText, styles.missedText]}>
                        {missedCount} missed
                      </Text>
                    </View>
                  )}
                  {quickTakes.length > 0 && (
                    <View style={styles.statItem}>
                      <Ionicons name="flash" size={18} color="#8b5cf6" />
                      <Text style={styles.statItemText}>
                        {quickTakes.length} as-needed
                      </Text>
                    </View>
                  )}
                  <View style={styles.statItem}>
                    <Ionicons name="medical" size={18} color="#3b82f6" />
                    <Text style={styles.statItemText}>
                      {takenCount + missedCount} scheduled
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
            {/* Taken Medications */}
            {selectedLogs?.taken &&
              selectedLogs.taken.filter((l) => l.reminderId !== "quick-take")
                .length > 0 && (
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
                      {
                        selectedLogs.taken.filter(
                          (l) => l.reminderId !== "quick-take",
                        ).length
                      }
                    </Text>
                  </View>
                  {selectedLogs.taken
                    .filter((l) => l.reminderId !== "quick-take")
                    .map((log) => (
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
                          </View>
                        </View>
                        <Text style={styles.detailDosage}>{log.dosage}</Text>
                        <Text style={styles.detailTime}>
                          Taken at {formatTime(log.takenAt)}
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

            {/* As-Needed / Quick Takes */}
            {selectedLogs?.taken &&
              selectedLogs.taken.filter((l) => l.reminderId === "quick-take")
                .length > 0 && (
                <View style={styles.logSection}>
                  <View style={styles.logSectionHeader}>
                    <Ionicons name="flash" size={22} color="#8b5cf6" />
                    <Text style={styles.logSectionTitle}>As Needed</Text>
                    <Text style={styles.logSectionCount}>
                      {
                        selectedLogs.taken.filter(
                          (l) => l.reminderId === "quick-take",
                        ).length
                      }
                    </Text>
                  </View>
                  {selectedLogs.taken
                    .filter((l) => l.reminderId === "quick-take")
                    .map((log) => (
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
              )}

            {/* Summary Card */}
            {selectedLogs && (
              <View style={styles.summaryCard}>
                <Text style={styles.summaryTitle}>Daily Summary</Text>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Compliance Rate</Text>
                  <Text style={styles.summaryValue}>
                    {getComplianceRate(
                      selectedLogs.taken.filter(
                        (l) => l.reminderId !== "quick-take",
                      ).length,
                      selectedLogs.missed.length,
                    )}
                    %
                  </Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Scheduled Total</Text>
                  <Text style={styles.summaryValue}>
                    {selectedLogs.taken.filter(
                      (l) => l.reminderId !== "quick-take",
                    ).length + selectedLogs.missed.length}
                  </Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Taken</Text>
                  <Text style={[styles.summaryValue, { color: "#10b981" }]}>
                    {
                      selectedLogs.taken.filter(
                        (l) => l.reminderId !== "quick-take",
                      ).length
                    }
                  </Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Missed</Text>
                  <Text style={[styles.summaryValue, { color: "#ef4444" }]}>
                    {selectedLogs.missed.length}
                  </Text>
                </View>
                {selectedLogs.taken.filter((l) => l.reminderId === "quick-take")
                  .length > 0 && (
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>As Needed</Text>
                    <Text style={[styles.summaryValue, { color: "#8b5cf6" }]}>
                      {
                        selectedLogs.taken.filter(
                          (l) => l.reminderId === "quick-take",
                        ).length
                      }
                    </Text>
                  </View>
                )}
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────
// Styles (keep your original styles here)
// ─────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  loadingText: { color: "#64748b", fontSize: 14 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  backButton: { width: 40, height: 40, justifyContent: "center" },
  headerTitle: { fontSize: 18, fontWeight: "700", color: "#0f172a" },
  statsContainer: {
    flexDirection: "row",
    padding: 16,
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  statValue: { fontSize: 24, fontWeight: "700", color: "#0f172a" },
  statLabel: { fontSize: 12, color: "#64748b", marginTop: 4 },
  filterContainer: {
    flexDirection: "row",
    marginHorizontal: 16,
    backgroundColor: "#f1f5f9",
    borderRadius: 10,
    padding: 4,
    marginBottom: 12,
  },
  filterTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: 8,
  },
  filterTabActive: {
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    elevation: 2,
  },
  filterText: { fontSize: 13, color: "#64748b", fontWeight: "500" },
  filterTextActive: { color: "#0f172a", fontWeight: "700" },
  content: { flex: 1, paddingHorizontal: 16 },
  emptyState: { alignItems: "center", paddingVertical: 60, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: "#0f172a" },
  emptyText: {
    fontSize: 14,
    color: "#64748b",
    textAlign: "center",
    lineHeight: 20,
  },
  logCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  logCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  logDate: { fontSize: 15, fontWeight: "700", color: "#0f172a" },
  complianceBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  complianceText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  logStats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 10,
  },
  statItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  statItemText: { fontSize: 13, color: "#475569" },
  missedText: { color: "#ef4444" },
  viewDetails: { marginTop: 4 },
  viewDetailsText: { fontSize: 12, color: "#94a3b8" },
  // Modal
  modalContainer: { flex: 1, backgroundColor: "#f8fafc" },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  modalTitle: { fontSize: 17, fontWeight: "700", color: "#0f172a" },
  modalContent: { flex: 1, padding: 16 },
  logSection: { marginBottom: 20 },
  logSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  logSectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0f172a",
    flex: 1,
  },
  logSectionCount: {
    fontSize: 13,
    color: "#64748b",
    backgroundColor: "#f1f5f9",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  detailCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  detailCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  detailMedName: { fontSize: 15, fontWeight: "600", color: "#0f172a", flex: 1 },
  detailDosage: { fontSize: 13, color: "#64748b", marginBottom: 4 },
  detailTime: { fontSize: 12, color: "#94a3b8" },
  takenBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#dcfce7",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  takenBadgeText: { fontSize: 11, color: "#10b981", fontWeight: "600" },
  missedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#fee2e2",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  missedBadgeText: { fontSize: 11, color: "#ef4444", fontWeight: "600" },
  summaryCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  summaryTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0f172a",
    marginBottom: 12,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  summaryLabel: { fontSize: 14, color: "#64748b" },
  summaryValue: { fontSize: 14, fontWeight: "700", color: "#0f172a" },
});
