// app/(tabs)/index.tsx
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
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

const { width } = Dimensions.get("window");
const DAY_WIDTH = 50;

export default function HomeScreen() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [refreshing, setRefreshing] = useState(false);
  const [medications, setMedications] = useState([
    { id: 1, name: "Atorvastatin", time: "8:00 AM", taken: true },
    { id: 2, name: "Metformin", time: "12:30 PM", taken: false },
    { id: 3, name: "Lisinopril", time: "6:00 PM", taken: false },
  ]);

  const scrollViewRef = useRef<ScrollView>(null);
  const isTodaySelected =
    selectedDate.toDateString() === new Date().toDateString();

  // Generate 30 days around the current date
  const generateDays = () => {
    const days = [];
    const today = new Date();

    // Start 15 days before today
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - 15);

    for (let i = 0; i < 30; i++) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + i);
      days.push(date);
    }

    return days;
  };

  const days = generateDays();
  const today = new Date();

  // Auto-scroll to today on initial load
  useEffect(() => {
    const timer = setTimeout(() => {
      scrollToToday();
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const getDayName = (date: Date) => {
    return date.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
  };

  const getDayNumber = (date: Date) => {
    return date.getDate().toString();
  };

  const isToday = (date: Date) => {
    return date.toDateString() === today.toDateString();
  };

  const isSelected = (date: Date) => {
    return date.toDateString() === selectedDate.toDateString();
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

  const getMedicationsForDate = (date: Date) => {
    // In a real app, this would filter medications from your database
    // For now, return some sample data
    if (date.toDateString() === today.toDateString()) {
      return medications;
    }
    return [];
  };

  // Pull to refresh handler
  const onRefresh = useCallback(() => {
    setRefreshing(true);

    // Simulate fetching new data (API call in real app)
    setTimeout(() => {
      // Reset all medications to not taken
      const updatedMedications = medications.map((med) => ({
        ...med,
        taken: false,
      }));
      setMedications(updatedMedications);

      // Scroll back to today
      scrollToToday();

      // Reset refreshing state
      setRefreshing(false);
    }, 1500);
  }, [medications]);

  const medicationsForSelectedDate = getMedicationsForDate(selectedDate);

  return (
    <SafeAreaView style={styles.container}>
      {/* Main Header with MEADGUARD and icons */}
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
        {/* Header with Today Button */}
        <View style={styles.header}>
          <View style={styles.headerTopRow}>
            <View style={styles.dateHeader}>
              <Text style={styles.todayText}>Today</Text>
              <Text style={styles.fullDate}>{formatDate(today)}</Text>
            </View>

            {/* Today Button */}
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
            {days.map((date, index) => (
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
                  {getDayName(date)}
                </Text>
                <Text
                  style={[
                    styles.dayNumber,
                    isToday(date) && styles.todayDayText,
                    isSelected(date) && styles.selectedText,
                  ]}
                >
                  {getDayNumber(date)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Main Content */}
        <View style={styles.content}>
          {/* Selected Date Title */}
          <View style={styles.selectedDateContainer}>
            <Text style={styles.selectedDateTitle}>
              {selectedDate.toDateString() === today.toDateString()
                ? "Today's Medications"
                : formatDate(selectedDate)}
            </Text>
          </View>

          {/* Medications for Selected Date */}
          {medicationsForSelectedDate.length > 0 ? (
            <View style={styles.medicationsCard}>
              {medicationsForSelectedDate.map((med) => (
                <View key={med.id} style={styles.medicationItem}>
                  <View style={styles.medInfo}>
                    <View style={styles.medHeader}>
                      <Text style={styles.medName}>{med.name}</Text>
                      <View
                        style={[
                          styles.statusIndicator,
                          med.taken
                            ? styles.takenIndicator
                            : styles.pendingIndicator,
                        ]}
                      />
                    </View>
                    <Text style={styles.medTime}>{med.time}</Text>
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.statusButton,
                      med.taken && styles.takenButton,
                    ]}
                    onPress={() => {
                      setMedications((prev) =>
                        prev.map((m) =>
                          m.id === med.id ? { ...m, taken: !m.taken } : m,
                        ),
                      );
                    }}
                  >
                    <Text style={styles.statusText}>
                      {med.taken ? "Taken ✓" : "Mark Taken"}
                    </Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.noMedicationsCard}>
              <View style={styles.noMedicationsContent}>
                <Ionicons
                  name="calendar-outline"
                  size={60}
                  color={Colors.textTertiary}
                />
                <Text style={styles.noMedicationsText}>
                  No medications scheduled for{" "}
                  {selectedDate.toDateString() === today.toDateString()
                    ? "Today"
                    : "this day"}
                </Text>
              </View>
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

          {/* Health Snapshot - Commented out for now */}
          {/* <View style={styles.healthCard}>
            <Text style={styles.sectionTitle}>Health Snapshot</Text>
            <View style={styles.healthStats}>
              <View style={styles.healthItem}>
                <Ionicons name="heart" size={24} color={Colors.error} />
                <Text style={styles.healthValue}>72</Text>
                <Text style={styles.healthLabel}>BPM</Text>
              </View>
              <View style={styles.healthItem}>
                <Ionicons name="water" size={24} color={Colors.primary} />
                <Text style={styles.healthValue}>85%</Text>
                <Text style={styles.healthLabel}>Hydration</Text>
              </View>
              <View style={styles.healthItem}>
                <Ionicons name="moon" size={24} color={Colors.primaryDark} />
                <Text style={styles.healthValue}>7.2</Text>
                <Text style={styles.healthLabel}>Sleep hrs</Text>
              </View>
            </View>
          </View> */}

          {/* Bottom spacer */}
          <View style={{ height: 20 }} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
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
  headerIcons: {
    flexDirection: "row",
    alignItems: "center",
  },
  iconButton: {
    marginLeft: 20,
    padding: 4,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
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
  dateHeader: {
    flex: 1,
  },
  todayText: {
    fontSize: 26,
    fontWeight: "800",
    color: Colors.surface,
  },
  todayDayText: {
    color: Colors.surface,
  },
  fullDate: {
    fontSize: 14,
    color: Colors.accent,
    marginTop: 4,
  },
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
  todayButtonText: {
    fontWeight: "600",
    marginLeft: 6,
    fontSize: 14,
  },
  todayButtonTextActive: {
    color: Colors.primary,
  },
  todayButtonTextInactive: {
    color: Colors.surface,
  },
  calendarContainer: {
    backgroundColor: Colors.primary,
    paddingBottom: 15,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 15,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  calendarContent: {
    paddingVertical: 0,
  },
  dayContainer: {
    width: DAY_WIDTH,
    alignItems: "center",
    paddingVertical: 8,
    marginHorizontal: 2,
    borderRadius: 10,
  },
  todayContainer: {
    backgroundColor: Colors.todayHighlight,
  },
  selectedContainer: {
    backgroundColor: Colors.selectedHighlight,
  },
  dayName: {
    fontSize: 12,
    color: "rgba(255, 255, 255, 0.8)",
    fontWeight: "500",
    marginBottom: 2,
  },
  dayNumber: {
    fontSize: 18,
    fontWeight: "bold",
    color: Colors.surface,
  },
  selectedText: {
    color: Colors.primary,
  },
  content: {
    paddingTop: 10,
  },
  selectedDateContainer: {
    paddingHorizontal: 20,
    marginBottom: 10,
    marginTop: 10,
  },
  selectedDateTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: Colors.text,
  },
  medicationsCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  medicationItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  medInfo: {
    flex: 1,
  },
  medHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  medName: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.text,
  },
  medTime: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  statusIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: 8,
  },
  takenIndicator: {
    backgroundColor: Colors.success,
  },
  pendingIndicator: {
    backgroundColor: Colors.warning,
  },
  statusButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: Colors.primary + "15",
    borderRadius: 20,
  },
  takenButton: {
    backgroundColor: Colors.success + "20",
  },
  statusText: {
    color: Colors.primary,
    fontWeight: "600",
    fontSize: 14,
  },
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
  noMedicationsContent: {
    alignItems: "center",
  },
  noMedicationsText: {
    fontSize: 16,
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
  },
  actionsContainer: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  actionButton: {
    alignItems: "center",
  },
  actionIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
  },
  actionText: {
    fontSize: 12,
    color: Colors.text,
  },
  // Health card styles kept for future use
  healthCard: {
    marginHorizontal: 16,
    marginBottom: 30,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  healthStats: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginTop: 16,
  },
  healthItem: {
    alignItems: "center",
  },
  healthValue: {
    fontSize: 20,
    fontWeight: "bold",
    color: Colors.text,
    marginTop: 8,
  },
  healthLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 4,
  },
});
