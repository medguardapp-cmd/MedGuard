// app/(tabs)/RemindersTab.tsx
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import Colors from "../../constants/colors";

interface Reminder {
  id: string;
  medicationId: string;
  medicationName: string;
  medicationDosage: string;
  times: string[];
  days: string[];
  enabled: boolean;
  sound: boolean;
  vibrate: boolean;
  label?: string;
  durationType?: "none" | "date-range" | "until-empty";
  startDate?: string;
  endDate?: string;
  createdAt?: any;
}

interface RemindersTabProps {
  reminders: Reminder[];
  medications: any[];
  onEditReminder: (reminder: Reminder) => void;
  onDeleteReminder: (id: string) => void;
  onToggleReminder: (id: string, enabled: boolean) => void;
  // ✅ New props for permissions
  isCaregiver?: boolean;
  canManageReminders?: boolean;
}

const formatTime = (time: string) => {
  const [hours, minutes] = time.split(":");
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
};

const getDaysString = (days: string[]) => {
  if (!days || days.length === 0) return "One-time";
  if (days.length === 7) return "Every day";
  if (days.length === 5 && !days.includes("Sat") && !days.includes("Sun"))
    return "Weekdays";
  if (days.length === 2 && days.includes("Sat") && days.includes("Sun"))
    return "Weekends";
  return days.join(", ");
};

export const RemindersTab: React.FC<RemindersTabProps> = ({
  reminders,
  onEditReminder,
  onDeleteReminder,
  onToggleReminder,
  isCaregiver = false,
  canManageReminders = true,
}) => {
  const sortedReminders = [...reminders].sort((a, b) =>
    (a.times[0] ?? "").localeCompare(b.times[0] ?? ""),
  );

  if (sortedReminders.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="alarm" size={60} color={Colors.textTertiary} />
        <Text style={styles.emptyStateText}>No reminders set</Text>
      </View>
    );
  }

  return (
    <View style={styles.remindersList}>
      {sortedReminders.map((reminder) => (
        <View key={reminder.id} style={styles.reminderCard}>
          {/* Top row: name + toggle */}
          <View style={styles.topRow}>
            <View style={styles.nameBlock}>
              <Text style={styles.reminderMedName}>
                {reminder.medicationName}
              </Text>
              <Text style={styles.reminderDosage}>
                {reminder.medicationDosage}
              </Text>
            </View>
            {/* ✅ Toggle switch - disabled for caregivers without permission */}
            <Switch
              value={reminder.enabled}
              onValueChange={() =>
                onToggleReminder(reminder.id, !reminder.enabled)
              }
              disabled={isCaregiver && !canManageReminders}
              trackColor={{ false: Colors.border, true: Colors.primary }}
              thumbColor={Colors.surface}
            />
          </View>

          {/* Time pills */}
          <View style={styles.timePillsRow}>
            {[...reminder.times]
              .sort((a, b) => a.localeCompare(b))
              .map((t, i) => (
                <View key={i} style={styles.timePill}>
                  <Text style={styles.timePillText}>{formatTime(t)}</Text>
                </View>
              ))}
          </View>

          {/* Divider */}
          <View style={styles.divider} />

          {/* Meta row */}
          <View style={styles.metaRow}>
            <Text style={styles.metaText}>{getDaysString(reminder.days)}</Text>
            {reminder.durationType === "date-range" &&
              reminder.startDate &&
              reminder.endDate && (
                <>
                  <View style={styles.metaDot} />
                  <Text style={styles.metaText}>
                    {reminder.startDate} → {reminder.endDate}
                  </Text>
                </>
              )}
            {reminder.durationType === "until-empty" && (
              <>
                <View style={styles.metaDot} />
                <Text style={styles.metaText}>Until empty</Text>
              </>
            )}
            {reminder.label && (
              <>
                <View style={styles.metaDot} />
                <Text style={styles.metaText}>{reminder.label}</Text>
              </>
            )}
            <View style={{ flex: 1 }} />
            {/* ✅ Edit button - disabled for caregivers without permission */}
            <TouchableOpacity
              onPress={() => onEditReminder(reminder)}
              style={styles.actionBtn}
              disabled={isCaregiver && !canManageReminders}
            >
              <Ionicons
                name="pencil"
                size={16}
                color={
                  isCaregiver && !canManageReminders
                    ? Colors.textTertiary
                    : Colors.primary
                }
              />
            </TouchableOpacity>
            {/* ✅ Delete button - disabled for caregivers without permission */}
            <TouchableOpacity
              onPress={() => onDeleteReminder(reminder.id)}
              style={styles.actionBtn}
              disabled={isCaregiver && !canManageReminders}
            >
              <Ionicons
                name="trash"
                size={16}
                color={
                  isCaregiver && !canManageReminders
                    ? Colors.textTertiary
                    : Colors.error
                }
              />
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  remindersList: { paddingBottom: 20 },
  reminderCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  nameBlock: { flex: 1, marginRight: 12 },
  reminderMedName: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.text,
    marginBottom: 2,
  },
  reminderDosage: { fontSize: 13, color: Colors.textSecondary },
  timePillsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 10,
  },
  timePill: {
    backgroundColor: Colors.primary + "15",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  timePillText: {
    fontSize: 13,
    fontWeight: "500",
    color: Colors.primary,
  },
  divider: {
    height: 0.5,
    backgroundColor: Colors.border,
    marginBottom: 10,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  metaText: { fontSize: 12, color: Colors.textTertiary },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: Colors.textTertiary,
  },
  actionBtn: { padding: 4 },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
  },
  emptyStateText: { fontSize: 16, color: Colors.textTertiary, marginTop: 16 },
});
