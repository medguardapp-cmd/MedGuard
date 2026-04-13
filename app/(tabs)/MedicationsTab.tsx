// app/(tabs)/MedicationsTab.tsx
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Colors from "../../constants/colors";

interface Medication {
  id: string;
  name: string;
  dosage: string;
  generic_name?: string;
  quantity: number;
  active: boolean;
  is_combination?: boolean;
  ingredients?: string[];
  refillReminder?: boolean;
  refillThreshold?: number;
}

interface Reminder {
  id: string;
  medicationId: string;
}

interface MedicationsTabProps {
  medications: Medication[];
  searchQuery: string;
  reminders: Reminder[];
  onAddReminder: () => void;
  onEditMedication: (medication: Medication) => void;
  onDeleteMedication: (id: string) => void;
}

export const MedicationsTab: React.FC<MedicationsTabProps> = ({
  medications,
  searchQuery,
  reminders,
  onAddReminder,
  onEditMedication,
  onDeleteMedication,
}) => {
  const filteredMedications = medications.filter(
    (med) =>
      med.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      med.dosage.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  if (filteredMedications.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="medical" size={60} color={Colors.textTertiary} />
        <Text style={styles.emptyStateText}>No medications found</Text>
      </View>
    );
  }

  return (
    <View style={styles.medicationsList}>
      {filteredMedications.map((medication) => (
        <View key={medication.id} style={styles.medicationCard}>
          <View style={styles.medicationHeader}>
            <View style={styles.medicationTitleContainer}>
              <Text style={styles.medicationName}>{medication.name}</Text>
              <View
                style={[
                  styles.statusBadge,
                  medication.active ? styles.activeBadge : styles.inactiveBadge,
                ]}
              >
                <Text style={styles.statusText}>
                  {medication.active ? "Active" : "Inactive"}
                </Text>
              </View>
            </View>
            <View style={styles.actionButtons}>
              <TouchableOpacity onPress={() => onEditMedication(medication)}>
                <Ionicons name="pencil" size={20} color={Colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => onDeleteMedication(medication.id)}
              >
                <Ionicons name="trash" size={20} color={Colors.error} />
              </TouchableOpacity>
            </View>
          </View>

          <Text style={styles.medicationDosage}>{medication.dosage}</Text>

          {medication.generic_name &&
            medication.generic_name !== medication.name && (
              <Text style={styles.genericName}>{medication.generic_name}</Text>
            )}

          <View style={styles.medicationDetails}>
            <View style={styles.detailItem}>
              <Ionicons name="cube" size={16} color={Colors.textSecondary} />
              <Text style={styles.detailText}>
                Quantity: {medication.quantity}
              </Text>
            </View>

            {reminders.filter((r) => r.medicationId === medication.id).length >
              0 && (
              <View style={styles.reminderBadge}>
                <Ionicons name="alarm" size={14} color={Colors.primary} />
                <Text style={styles.reminderBadgeText}>
                  {
                    reminders.filter((r) => r.medicationId === medication.id)
                      .length
                  }{" "}
                  reminder(s)
                </Text>
              </View>
            )}
          </View>

          <TouchableOpacity
            style={styles.quickAddReminder}
            onPress={onAddReminder}
          >
            <Ionicons
              name="add-circle-outline"
              size={20}
              color={Colors.primary}
            />
            <Text style={styles.quickAddReminderText}>Add Reminder</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  medicationsList: { paddingBottom: 20 },
  medicationCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  medicationHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 8,
  },
  medicationTitleContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
  },
  medicationName: {
    fontSize: 18,
    fontWeight: "bold",
    color: Colors.text,
    marginRight: 8,
  },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12 },
  activeBadge: { backgroundColor: Colors.success + "20" },
  inactiveBadge: { backgroundColor: Colors.textTertiary + "20" },
  statusText: { fontSize: 10, fontWeight: "600", color: Colors.text },
  actionButtons: { flexDirection: "row", gap: 12 },
  medicationDosage: {
    fontSize: 14,
    color: Colors.primary,
    fontWeight: "500",
    marginBottom: 4,
  },
  genericName: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 8,
    fontStyle: "italic",
  },
  medicationDetails: { gap: 8 },
  detailItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  detailText: { fontSize: 14, color: Colors.textSecondary, flex: 1 },
  reminderBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.primary + "10",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: "flex-start",
    gap: 4,
    marginTop: 4,
  },
  reminderBadgeText: { fontSize: 12, color: Colors.primary, fontWeight: "500" },
  quickAddReminder: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: 8,
  },
  quickAddReminderText: {
    fontSize: 14,
    color: Colors.primary,
    fontWeight: "500",
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
  },
  emptyStateText: { fontSize: 16, color: Colors.textTertiary, marginTop: 16 },
});
