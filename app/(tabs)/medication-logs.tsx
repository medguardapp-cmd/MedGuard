// app/(tabs)/medication-logs.tsx
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
    collection,
    getDocs,
    onSnapshot,
    orderBy,
    query
} from "firebase/firestore";
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

// Types
interface TakenLog {
  id: string;
  medicationId: string;
  reminderId: string;
  name: string;
  dosage: string;
  takenAt: any;
  dateKey: string;
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

interface Medication {
  id: string;
  name: string;
  dosage: string;
  active: boolean;
}

interface ScheduleSnapshotItem {
  reminderId: string;
  medicationId: string;
  name: string;
  dosage: string;
  time: string;
}

// Helper function to normalize dates (remove time component)
const normalizeDate = (date: Date): Date => {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
};

// Helper function to get snapshot key for a date
const snapshotKey = (date: Date): string => {
  return date.toISOString().split("T")[0];
};

export default function MedicationLogsScreen() {
  const router = useRouter();
  const [takenLogs, setTakenLogs] = useState<TakenLog[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [snapshots, setSnapshots] = useState<
    Record<string, ScheduleSnapshotItem[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [selectedDateLogs, setSelectedDateLogs] = useState<{
    date: Date;
    taken: TakenLog[];
    missed: ScheduleSnapshotItem[];
  } | null>(null);
  const [logsModalVisible, setLogsModalVisible] = useState(false);
  const [filterType, setFilterType] = useState<"all" | "taken" | "missed">(
    "all",
  );

  // Load data
  useEffect(() => {
    const userId = auth.currentUser?.uid;
    if (!userId) return;

    // Load taken logs
    const unsubscribeTaken = onSnapshot(
      query(
        collection(db, "users", userId, "taken_logs"),
        orderBy("takenAt", "desc"),
      ),
      (snapshot) => {
        const logs = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as TakenLog[];
        setTakenLogs(logs);
      },
    );

    // Load reminders
    const unsubscribeReminders = onSnapshot(
      collection(db, "users", userId, "reminders"),
      (snapshot) => {
        setReminders(
          snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          })) as Reminder[],
        );
      },
    );

    // Load medications
    const unsubscribeMeds = onSnapshot(
      collection(db, "users", userId, "medications"),
      (snapshot) => {
        setMedications(
          snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          })) as Medication[],
        );
      },
    );

    // Load past snapshots
    const loadSnapshots = async () => {
      try {
        const cache: Record<string, ScheduleSnapshotItem[]> = {};
        const today = normalizeDate(new Date());

        // Load last 30 days of snapshots
        for (let i = 1; i <= 30; i++) {
          const date = new Date(today);
          date.setDate(today.getDate() - i);
          const sk = snapshotKey(date);

          try {
            const snapDoc = await getDocs(
              collection(db, "users", userId, "schedule_snapshots"),
            );
            snapDoc.forEach((doc) => {
              if (doc.id === sk) {
                cache[sk] = doc.data()?.items ?? [];
              }
            });
          } catch (error) {
            console.warn(`Failed to load snapshot for ${sk}:`, error);
          }
        }
        setSnapshots(cache);
      } catch (error) {
        console.error("Error loading snapshots:", error);
      } finally {
        setLoading(false);
      }
    };
    loadSnapshots();

    return () => {
      unsubscribeTaken();
      unsubscribeReminders();
      unsubscribeMeds();
    };
  }, []);

  // Group logs by date
  const getLogsByDate = () => {
    const logsByDate: Record<
      string,
      { taken: TakenLog[]; missed: ScheduleSnapshotItem[] }
    > = {};

    // Group taken logs
    takenLogs.forEach((log) => {
      const dateKey = log.dateKey;
      if (!logsByDate[dateKey]) {
        logsByDate[dateKey] = { taken: [], missed: [] };
      }
      logsByDate[dateKey].taken.push(log);
    });

    // Group missed medications from snapshots
    Object.entries(snapshots).forEach(([dateKey, items]) => {
      const logsForDate = takenLogs.filter((l) => l.dateKey === dateKey);
      const missedItems = items.filter(
        (item) =>
          !logsForDate.find((log) => log.reminderId === item.reminderId),
      );

      if (missedItems.length > 0) {
        if (!logsByDate[dateKey]) {
          logsByDate[dateKey] = { taken: [], missed: [] };
        }
        logsByDate[dateKey].missed = missedItems;
      }
    });

    // Sort dates descending (newest first)
    const sortedDates = Object.keys(logsByDate).sort(
      (a, b) => new Date(b).getTime() - new Date(a).getTime(),
    );

    return { logsByDate, sortedDates };
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const today = normalizeDate(new Date());
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return "Today";
    } else if (date.toDateString() === yesterday.toDateString()) {
      return "Yesterday";
    } else {
      return date.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    }
  };

  const formatTime = (timestamp: any) => {
    if (!timestamp) return "";
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const openDateLogs = (
    dateKey: string,
    taken: TakenLog[],
    missed: ScheduleSnapshotItem[],
  ) => {
    setSelectedDateLogs({
      date: new Date(dateKey),
      taken,
      missed,
    });
    setLogsModalVisible(true);
  };

  const getComplianceRate = (taken: number, missed: number) => {
    const total = taken + missed;
    if (total === 0) return 0;
    return Math.round((taken / total) * 100);
  };

  const getFilteredDates = (sortedDates: string[], logsByDate: any) => {
    if (filterType === "all") return sortedDates;

    return sortedDates.filter((dateKey) => {
      const { taken, missed } = logsByDate[dateKey];
      if (filterType === "taken") return taken.length > 0;
      if (filterType === "missed") return missed.length > 0;
      return true;
    });
  };

  const { logsByDate, sortedDates } = getLogsByDate();
  const filteredDates = getFilteredDates(sortedDates, logsByDate);

  // Calculate overall stats
  const totalTaken = takenLogs.length;
  const totalMissed = Object.values(snapshots).reduce(
    (sum, items) => sum + items.length,
    0,
  );
  const overallCompliance = getComplianceRate(totalTaken, totalMissed);

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
        <TouchableOpacity
          style={[
            styles.filterTab,
            filterType === "all" && styles.filterTabActive,
          ]}
          onPress={() => setFilterType("all")}
        >
          <Text
            style={[
              styles.filterText,
              filterType === "all" && styles.filterTextActive,
            ]}
          >
            All
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.filterTab,
            filterType === "taken" && styles.filterTabActive,
          ]}
          onPress={() => setFilterType("taken")}
        >
          <Text
            style={[
              styles.filterText,
              filterType === "taken" && styles.filterTextActive,
            ]}
          >
            Taken
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.filterTab,
            filterType === "missed" && styles.filterTabActive,
          ]}
          onPress={() => setFilterType("missed")}
        >
          <Text
            style={[
              styles.filterText,
              filterType === "missed" && styles.filterTextActive,
            ]}
          >
            Missed
          </Text>
        </TouchableOpacity>
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
          filteredDates.map((dateKey) => {
            const { taken, missed } = logsByDate[dateKey];
            const takenCount = taken.length;
            const missedCount = missed.length;
            const complianceRate = getComplianceRate(takenCount, missedCount);

            return (
              <TouchableOpacity
                key={dateKey}
                style={styles.logCard}
                onPress={() => openDateLogs(dateKey, taken, missed)}
              >
                <View style={styles.logCardHeader}>
                  <Text style={styles.logDate}>{formatDate(dateKey)}</Text>
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
                  <View style={styles.statItem}>
                    <Ionicons name="medical" size={18} color="#3b82f6" />
                    <Text style={styles.statItemText}>
                      {takenCount + missedCount} total
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
              {selectedDateLogs?.date
                ? formatDate(selectedDateLogs.date.toDateString())
                : ""}
            </Text>
            <View style={{ width: 24 }} />
          </View>

          <ScrollView style={styles.modalContent}>
            {/* Taken Medications */}
            {selectedDateLogs?.taken && selectedDateLogs.taken.length > 0 && (
              <View style={styles.logSection}>
                <View style={styles.logSectionHeader}>
                  <Ionicons name="checkmark-circle" size={22} color="#10b981" />
                  <Text style={styles.logSectionTitle}>Taken Medications</Text>
                  <Text style={styles.logSectionCount}>
                    {selectedDateLogs.taken.length}
                  </Text>
                </View>
                {selectedDateLogs.taken.map((log) => (
                  <View key={log.id} style={styles.detailCard}>
                    <View style={styles.detailCardHeader}>
                      <Text style={styles.detailMedName}>{log.name}</Text>
                      <View style={styles.takenBadge}>
                        <Ionicons name="checkmark" size={12} color="#10b981" />
                        <Text style={styles.takenBadgeText}>Taken</Text>
                      </View>
                    </View>
                    <Text style={styles.detailDosage}>{log.dosage}</Text>
                    <Text style={styles.detailTime}>
                      <Ionicons name="time-outline" size={12} color="#64748b" />{" "}
                      Taken at {formatTime(log.takenAt)}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* Missed Medications */}
            {selectedDateLogs?.missed && selectedDateLogs.missed.length > 0 && (
              <View style={styles.logSection}>
                <View style={styles.logSectionHeader}>
                  <Ionicons name="close-circle" size={22} color="#ef4444" />
                  <Text style={styles.logSectionTitle}>Missed Medications</Text>
                  <Text style={styles.logSectionCount}>
                    {selectedDateLogs.missed.length}
                  </Text>
                </View>
                {selectedDateLogs.missed.map((item, index) => (
                  <View key={index} style={styles.detailCard}>
                    <View style={styles.detailCardHeader}>
                      <Text style={styles.detailMedName}>{item.name}</Text>
                      <View style={styles.missedBadge}>
                        <Ionicons name="close" size={12} color="#ef4444" />
                        <Text style={styles.missedBadgeText}>Missed</Text>
                      </View>
                    </View>
                    <Text style={styles.detailDosage}>{item.dosage}</Text>
                    <Text style={styles.detailTime}>
                      <Ionicons name="time-outline" size={12} color="#64748b" />{" "}
                      Scheduled at {formatTime(item.time)}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* Summary Card */}
            {selectedDateLogs && (
              <View style={styles.summaryCard}>
                <Text style={styles.summaryTitle}>Daily Summary</Text>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Compliance Rate</Text>
                  <Text style={styles.summaryValue}>
                    {getComplianceRate(
                      selectedDateLogs.taken.length,
                      selectedDateLogs.missed.length,
                    )}
                    %
                  </Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Total Medications</Text>
                  <Text style={styles.summaryValue}>
                    {selectedDateLogs.taken.length +
                      selectedDateLogs.missed.length}
                  </Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Taken</Text>
                  <Text style={[styles.summaryValue, { color: "#10b981" }]}>
                    {selectedDateLogs.taken.length}
                  </Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Missed</Text>
                  <Text style={[styles.summaryValue, { color: "#ef4444" }]}>
                    {selectedDateLogs.missed.length}
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
    fontSize: 16,
    color: "#64748b",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "white",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#0f172a",
  },
  statsContainer: {
    flexDirection: "row",
    padding: 16,
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  statValue: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#3b82f6",
  },
  statLabel: {
    fontSize: 12,
    color: "#64748b",
    marginTop: 4,
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
    color: "white",
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#475569",
    marginTop: 16,
  },
  emptyText: {
    fontSize: 14,
    color: "#94a3b8",
    marginTop: 8,
    textAlign: "center",
  },
  logCard: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
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
    borderRadius: 20,
  },
  complianceText: {
    fontSize: 12,
    fontWeight: "600",
    color: "white",
  },
  logStats: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 12,
  },
  statItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statItemText: {
    fontSize: 14,
    color: "#475569",
  },
  missedText: {
    color: "#ef4444",
  },
  viewDetails: {
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
    paddingTop: 12,
    alignItems: "flex-end",
  },
  viewDetailsText: {
    fontSize: 13,
    color: "#3b82f6",
    fontWeight: "500",
  },
  modalContainer: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "white",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#0f172a",
  },
  modalContent: {
    flex: 1,
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
    backgroundColor: "white",
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
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
    backgroundColor: "#10b981",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  takenBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: "white",
  },
  missedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#ef4444",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  missedBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: "white",
  },
  detailDosage: {
    fontSize: 13,
    color: "#64748b",
    marginBottom: 4,
  },
  detailTime: {
    fontSize: 12,
    color: "#94a3b8",
  },
  summaryCard: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
    marginBottom: 24,
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
    borderBottomColor: "#f1f5f9",
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
