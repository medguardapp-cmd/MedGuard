// app/(tabs)/medications.tsx
import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Colors from "../../constants/colors";

// Types
interface Medication {
  id: string;
  name: string;
  dosage: string;
  quantity: number;
  refillReminder: boolean;
  refillThreshold?: number;
  active: boolean;
  notes?: string;
}

interface Reminder {
  id: string;
  medicationId: string;
  medicationName: string;
  medicationDosage: string;
  time: string; // Format: "HH:MM"
  days: string[]; // ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
  enabled: boolean;
  sound: boolean;
  vibrate: boolean;
  label?: string;
}

export default function MedicationsScreen() {
  const [medications, setMedications] = useState<Meditation[]>([
    {
      id: "1",
      name: "Atorvastatin",
      dosage: "10mg",
      quantity: 30,
      refillReminder: true,
      refillThreshold: 5,
      active: true,
    },
    {
      id: "2",
      name: "Metformin",
      dosage: "500mg",
      quantity: 60,
      refillReminder: true,
      refillThreshold: 10,
      active: true,
    },
    {
      id: "3",
      name: "Lisinopril",
      dosage: "20mg",
      quantity: 30,
      refillReminder: false,
      active: true,
    },
    {
      id: "4",
      name: "Ibuprofen",
      dosage: "400mg",
      quantity: 20,
      refillReminder: false,
      active: true,
    },
  ]);

  const [reminders, setReminders] = useState<Reminder[]>([
    {
      id: "r1",
      medicationId: "1",
      medicationName: "Atorvastatin",
      medicationDosage: "10mg",
      time: "08:00",
      days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      enabled: true,
      sound: true,
      vibrate: true,
    },
    {
      id: "r2",
      medicationId: "2",
      medicationName: "Metformin",
      medicationDosage: "500mg",
      time: "08:00",
      days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      enabled: true,
      sound: true,
      vibrate: true,
    },
    {
      id: "r3",
      medicationId: "2",
      medicationName: "Metformin",
      medicationDosage: "500mg",
      time: "20:00",
      days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      enabled: true,
      sound: true,
      vibrate: true,
    },
    {
      id: "r4",
      medicationId: "3",
      medicationName: "Lisinopril",
      medicationDosage: "20mg",
      time: "18:00",
      days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      enabled: false,
      sound: true,
      vibrate: true,
    },
  ]);

  const [modalVisible, setModalVisible] = useState(false);
  const [reminderModalVisible, setReminderModalVisible] = useState(false);
  const [editingMedication, setEditingMedication] = useState<Medication | null>(
    null,
  );
  const [editingReminder, setEditingReminder] = useState<Reminder | null>(null);
  const [activeTab, setActiveTab] = useState<"medications" | "reminders">(
    "medications",
  );
  const [searchQuery, setSearchQuery] = useState("");

  // Form state for new/edit medication
  const [formData, setFormData] = useState<Partial<Medication>>({
    name: "",
    dosage: "",
    quantity: 0,
    refillReminder: false,
    active: true,
  });

  // Form state for new/edit reminder
  const [reminderFormData, setReminderFormData] = useState<Partial<Reminder>>({
    medicationId: "",
    medicationName: "",
    medicationDosage: "",
    time: "08:00",
    days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    enabled: true,
    sound: true,
    vibrate: true,
  });

  const [selectedMedicationForReminder, setSelectedMedicationForReminder] =
    useState<Medication | null>(null);
  const [showMedicationSelector, setShowMedicationSelector] = useState(false);

  const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const handleAddMedication = () => {
    setEditingMedication(null);
    setFormData({
      name: "",
      dosage: "",
      quantity: 0,
      refillReminder: false,
      active: true,
    });
    setModalVisible(true);
  };

  const handleAddReminder = () => {
    setEditingReminder(null);
    setSelectedMedicationForReminder(null);
    setReminderFormData({
      time: "08:00",
      days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      enabled: true,
      sound: true,
      vibrate: true,
    });
    setShowMedicationSelector(true);
  };

  const handleEditReminder = (reminder: Reminder) => {
    setEditingReminder(reminder);
    setReminderFormData(reminder);
    const medication = medications.find((m) => m.id === reminder.medicationId);
    setSelectedMedicationForReminder(medication || null);
    setReminderModalVisible(true);
  };

  const handleDeleteReminder = (id: string) => {
    Alert.alert(
      "Delete Reminder",
      "Are you sure you want to delete this reminder?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            setReminders(reminders.filter((r) => r.id !== id));
          },
        },
      ],
    );
  };

  const handleToggleReminder = (id: string) => {
    setReminders(
      reminders.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)),
    );
  };

  const handleEditMedication = (medication: Medication) => {
    setEditingMedication(medication);
    setFormData(medication);
    setModalVisible(true);
  };

  const handleDeleteMedication = (id: string) => {
    Alert.alert(
      "Delete Medication",
      "Are you sure you want to delete this medication? Any associated reminders will also be deleted.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            setMedications(medications.filter((m) => m.id !== id));
            // Also delete related reminders
            setReminders(reminders.filter((r) => r.medicationId !== id));
          },
        },
      ],
    );
  };

  const handleSaveMedication = () => {
    if (!formData.name || !formData.dosage) {
      Alert.alert("Error", "Please fill in all required fields");
      return;
    }

    if (editingMedication) {
      // Update existing medication
      setMedications(
        medications.map((m) =>
          m.id === editingMedication.id
            ? ({ ...m, ...formData, id: m.id } as Medication)
            : m,
        ),
      );
    } else {
      // Add new medication
      const newMedication: Medication = {
        id: Date.now().toString(),
        name: formData.name || "",
        dosage: formData.dosage || "",
        quantity: formData.quantity || 0,
        refillReminder: formData.refillReminder || false,
        active: true,
        notes: formData.notes,
      };
      setMedications([...medications, newMedication]);

      // Ask if user wants to add a reminder
      Alert.alert(
        "Add Reminder",
        "Would you like to set up a reminder for this medication?",
        [
          { text: "Not Now", style: "cancel" },
          {
            text: "Add Reminder",
            onPress: () => {
              setSelectedMedicationForReminder(newMedication);
              setReminderFormData({
                medicationId: newMedication.id,
                medicationName: newMedication.name,
                medicationDosage: newMedication.dosage,
                time: "08:00",
                days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
                enabled: true,
                sound: true,
                vibrate: true,
              });
              setReminderModalVisible(true);
            },
          },
        ],
      );
    }

    setModalVisible(false);
  };

  const handleSaveReminder = () => {
    if (!selectedMedicationForReminder) {
      Alert.alert("Error", "Please select a medication");
      return;
    }

    const newReminder: Reminder = {
      id: editingReminder?.id || Date.now().toString(),
      medicationId: selectedMedicationForReminder.id,
      medicationName: selectedMedicationForReminder.name,
      medicationDosage: selectedMedicationForReminder.dosage,
      time: reminderFormData.time || "08:00",
      days: reminderFormData.days || [],
      enabled: reminderFormData.enabled !== false,
      sound: reminderFormData.sound !== false,
      vibrate: reminderFormData.vibrate !== false,
      label: reminderFormData.label,
    };

    if (editingReminder) {
      // Update existing reminder
      setReminders(
        reminders.map((r) => (r.id === editingReminder.id ? newReminder : r)),
      );
    } else {
      // Add new reminder
      setReminders([...reminders, newReminder]);
    }

    setReminderModalVisible(false);
    setShowMedicationSelector(false);
    setSelectedMedicationForReminder(null);
  };

  const toggleDay = (day: string) => {
    const currentDays = reminderFormData.days || [];
    if (currentDays.includes(day)) {
      setReminderFormData({
        ...reminderFormData,
        days: currentDays.filter((d) => d !== day),
      });
    } else {
      setReminderFormData({
        ...reminderFormData,
        days: [...currentDays, day],
      });
    }
  };

  const selectMedication = (medication: Medication) => {
    setSelectedMedicationForReminder(medication);
    setReminderFormData({
      ...reminderFormData,
      medicationId: medication.id,
      medicationName: medication.name,
      medicationDosage: medication.dosage,
    });
    setShowMedicationSelector(false);
    setReminderModalVisible(true);
  };

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(":");
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? "PM" : "AM";
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  };

  const getDaysString = (days: string[]) => {
    if (days.length === 7) return "Every day";
    if (
      days.length === 5 &&
      days.includes("Mon") &&
      days.includes("Tue") &&
      days.includes("Wed") &&
      days.includes("Thu") &&
      days.includes("Fri") &&
      !days.includes("Sat") &&
      !days.includes("Sun")
    ) {
      return "Weekdays";
    }
    if (days.length === 2 && days.includes("Sat") && days.includes("Sun")) {
      return "Weekends";
    }
    return days.join(", ");
  };

  const filteredMedications = medications.filter(
    (med) =>
      med.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      med.dosage.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  // Sort reminders by time
  const sortedReminders = [...reminders].sort((a, b) =>
    a.time.localeCompare(b.time),
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Medications</Text>
        <View style={styles.headerButtons}>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={handleAddReminder}
          >
            <Ionicons name="alarm" size={24} color={Colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={handleAddMedication}
          >
            <Ionicons name="add-circle" size={28} color={Colors.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={20} color={Colors.textTertiary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search medications..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholderTextColor={Colors.textTertiary}
        />
      </View>

      {/* Tab Navigation */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === "medications" && styles.activeTab]}
          onPress={() => setActiveTab("medications")}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === "medications" && styles.activeTabText,
            ]}
          >
            Medications
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === "reminders" && styles.activeTab]}
          onPress={() => setActiveTab("reminders")}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === "reminders" && styles.activeTabText,
            ]}
          >
            All Reminders
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: 55,
        }}
      >
        {activeTab === "medications" ? (
          // Medications List
          <View style={styles.medicationsList}>
            {filteredMedications.length > 0 ? (
              filteredMedications.map((medication) => (
                <View key={medication.id} style={styles.medicationCard}>
                  <View style={styles.medicationHeader}>
                    <View style={styles.medicationTitleContainer}>
                      <Text style={styles.medicationName}>
                        {medication.name}
                      </Text>
                      <View
                        style={[
                          styles.statusBadge,
                          medication.active
                            ? styles.activeBadge
                            : styles.inactiveBadge,
                        ]}
                      >
                        <Text style={styles.statusText}>
                          {medication.active ? "Active" : "Inactive"}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.actionButtons}>
                      <TouchableOpacity
                        onPress={() => handleEditMedication(medication)}
                      >
                        <Ionicons
                          name="pencil"
                          size={20}
                          color={Colors.primary}
                        />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleDeleteMedication(medication.id)}
                      >
                        <Ionicons name="trash" size={20} color={Colors.error} />
                      </TouchableOpacity>
                    </View>
                  </View>

                  <Text style={styles.medicationDosage}>
                    {medication.dosage}
                  </Text>

                  <View style={styles.medicationDetails}>
                    <View style={styles.detailItem}>
                      <Ionicons
                        name="cube"
                        size={16}
                        color={Colors.textSecondary}
                      />
                      <Text style={styles.detailText}>
                        Quantity: {medication.quantity}
                      </Text>
                    </View>

                    {medication.refillReminder && (
                      <View style={styles.refillBadge}>
                        <Ionicons
                          name="alert-circle"
                          size={14}
                          color={Colors.warning}
                        />
                        <Text style={styles.refillText}>
                          Refill when below {medication.refillThreshold}
                        </Text>
                      </View>
                    )}

                    {/* Show associated reminders count */}
                    {reminders.filter((r) => r.medicationId === medication.id)
                      .length > 0 && (
                      <View style={styles.reminderBadge}>
                        <Ionicons
                          name="alarm"
                          size={14}
                          color={Colors.primary}
                        />
                        <Text style={styles.reminderBadgeText}>
                          {
                            reminders.filter(
                              (r) => r.medicationId === medication.id,
                            ).length
                          }{" "}
                          reminder(s)
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Quick add reminder button */}
                  <TouchableOpacity
                    style={styles.quickAddReminder}
                    onPress={() => {
                      setSelectedMedicationForReminder(medication);
                      setReminderFormData({
                        medicationId: medication.id,
                        medicationName: medication.name,
                        medicationDosage: medication.dosage,
                        time: "08:00",
                        days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
                        enabled: true,
                        sound: true,
                        vibrate: true,
                      });
                      setReminderModalVisible(true);
                    }}
                  >
                    <Ionicons
                      name="add-circle-outline"
                      size={20}
                      color={Colors.primary}
                    />
                    <Text style={styles.quickAddReminderText}>
                      Add Reminder
                    </Text>
                  </TouchableOpacity>
                </View>
              ))
            ) : (
              <View style={styles.emptyState}>
                <Ionicons
                  name="medical"
                  size={60}
                  color={Colors.textTertiary}
                />
                <Text style={styles.emptyStateText}>No medications found</Text>
                <TouchableOpacity
                  style={styles.emptyStateButton}
                  onPress={handleAddMedication}
                >
                  <Text style={styles.emptyStateButtonText}>
                    Add Your First Medication
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        ) : (
          // All Reminders (Alarms style)
          <View style={styles.remindersList}>
            {sortedReminders.length > 0 ? (
              sortedReminders.map((reminder) => (
                <View key={reminder.id} style={styles.reminderCard}>
                  <View style={styles.reminderLeft}>
                    <Switch
                      value={reminder.enabled}
                      onValueChange={() => handleToggleReminder(reminder.id)}
                      trackColor={{
                        false: Colors.border,
                        true: Colors.primary,
                      }}
                      thumbColor={Colors.surface}
                    />
                  </View>

                  <View style={styles.reminderCenter}>
                    <Text style={styles.reminderTime}>
                      {formatTime(reminder.time)}
                    </Text>
                    <Text style={styles.reminderMedName}>
                      {reminder.medicationName} {reminder.medicationDosage}
                    </Text>
                    <View style={styles.reminderDays}>
                      <Text style={styles.reminderDaysText}>
                        {getDaysString(reminder.days)}
                      </Text>
                      {reminder.label && (
                        <View style={styles.reminderLabel}>
                          <Text style={styles.reminderLabelText}>
                            {reminder.label}
                          </Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.reminderFeatures}>
                      {reminder.sound && (
                        <Ionicons
                          name="musical-note"
                          size={14}
                          color={Colors.textTertiary}
                        />
                      )}
                      {reminder.vibrate && (
                        <Ionicons
                          name="phone-portrait"
                          size={14}
                          color={Colors.textTertiary}
                        />
                      )}
                    </View>
                  </View>

                  <View style={styles.reminderRight}>
                    <TouchableOpacity
                      style={styles.reminderAction}
                      onPress={() => handleEditReminder(reminder)}
                    >
                      <Ionicons
                        name="pencil"
                        size={20}
                        color={Colors.primary}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.reminderAction}
                      onPress={() => handleDeleteReminder(reminder.id)}
                    >
                      <Ionicons name="trash" size={20} color={Colors.error} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            ) : (
              <View style={styles.emptyState}>
                <Ionicons name="alarm" size={60} color={Colors.textTertiary} />
                <Text style={styles.emptyStateText}>No reminders set</Text>
                <TouchableOpacity
                  style={styles.emptyStateButton}
                  onPress={handleAddReminder}
                >
                  <Text style={styles.emptyStateButtonText}>
                    Create Your First Reminder
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* Add/Edit Medication Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingMedication ? "Edit Medication" : "Add New Medication"}
              </Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Ionicons name="close" size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{
                paddingBottom: 55,
              }}
            >
              <View style={styles.formGroup}>
                <Text style={styles.label}>Medication Name *</Text>
                <TextInput
                  style={styles.input}
                  value={formData.name}
                  onChangeText={(text) =>
                    setFormData({ ...formData, name: text })
                  }
                  placeholder="e.g., Atorvastatin"
                  placeholderTextColor={Colors.textTertiary}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>Dosage *</Text>
                <TextInput
                  style={styles.input}
                  value={formData.dosage}
                  onChangeText={(text) =>
                    setFormData({ ...formData, dosage: text })
                  }
                  placeholder="e.g., 10mg"
                  placeholderTextColor={Colors.textTertiary}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>Quantity</Text>
                <TextInput
                  style={styles.input}
                  value={formData.quantity?.toString()}
                  onChangeText={(text) =>
                    setFormData({ ...formData, quantity: parseInt(text) || 0 })
                  }
                  placeholder="Number of pills/units"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardType="numeric"
                />
              </View>

              <View style={styles.formGroup}>
                <View style={styles.switchContainer}>
                  <Text style={styles.label}>Refill Reminder</Text>
                  <Switch
                    value={formData.refillReminder}
                    onValueChange={(value) =>
                      setFormData({ ...formData, refillReminder: value })
                    }
                    trackColor={{ false: Colors.border, true: Colors.primary }}
                    thumbColor={Colors.surface}
                  />
                </View>
              </View>

              {formData.refillReminder && (
                <View style={styles.formGroup}>
                  <Text style={styles.label}>Refill Threshold</Text>
                  <TextInput
                    style={styles.input}
                    value={formData.refillThreshold?.toString()}
                    onChangeText={(text) =>
                      setFormData({
                        ...formData,
                        refillThreshold: parseInt(text) || 0,
                      })
                    }
                    placeholder="Remind when quantity below"
                    placeholderTextColor={Colors.textTertiary}
                    keyboardType="numeric"
                  />
                </View>
              )}

              <View style={styles.formGroup}>
                <Text style={styles.label}>Notes (Optional)</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={formData.notes}
                  onChangeText={(text) =>
                    setFormData({ ...formData, notes: text })
                  }
                  placeholder="Additional notes"
                  placeholderTextColor={Colors.textTertiary}
                  multiline
                  numberOfLines={3}
                />
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setModalVisible(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.saveButton]}
                onPress={handleSaveMedication}
              >
                <Text style={styles.saveButtonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Medication Selector Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={showMedicationSelector}
        onRequestClose={() => setShowMedicationSelector(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Medication</Text>
              <TouchableOpacity
                onPress={() => setShowMedicationSelector(false)}
              >
                <Ionicons name="close" size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{
                paddingBottom: 55,
              }}
            >
              {medications
                .filter((m) => m.active)
                .map((medication) => (
                  <TouchableOpacity
                    key={medication.id}
                    style={styles.medicationSelectorItem}
                    onPress={() => selectMedication(medication)}
                  >
                    <View>
                      <Text style={styles.selectorMedName}>
                        {medication.name}
                      </Text>
                      <Text style={styles.selectorMedDosage}>
                        {medication.dosage}
                      </Text>
                    </View>
                    <Ionicons
                      name="chevron-forward"
                      size={20}
                      color={Colors.textTertiary}
                    />
                  </TouchableOpacity>
                ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Add/Edit Reminder Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={reminderModalVisible}
        onRequestClose={() => {
          setReminderModalVisible(false);
          setSelectedMedicationForReminder(null);
        }}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingReminder ? "Edit Reminder" : "New Reminder"}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setReminderModalVisible(false);
                  setSelectedMedicationForReminder(null);
                }}
              >
                <Ionicons name="close" size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>

            {selectedMedicationForReminder && (
              <View style={styles.selectedMedicationInfo}>
                <Text style={styles.selectedMedicationName}>
                  {selectedMedicationForReminder.name}{" "}
                  {selectedMedicationForReminder.dosage}
                </Text>
              </View>
            )}

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{
                paddingBottom: 30,
              }}
            >
              <View style={styles.formGroup}>
                <Text style={styles.label}>Time</Text>
                <View style={styles.timePickerContainer}>
                  <TextInput
                    style={[styles.input, styles.timeInput]}
                    value={reminderFormData.time}
                    onChangeText={(text) =>
                      setReminderFormData({ ...reminderFormData, time: text })
                    }
                    placeholder="HH:MM (24h format)"
                    placeholderTextColor={Colors.textTertiary}
                  />
                </View>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>Repeat</Text>
                <View style={styles.daysContainer}>
                  {weekDays.map((day) => (
                    <TouchableOpacity
                      key={day}
                      style={[
                        styles.dayButton,
                        reminderFormData.days?.includes(day) &&
                          styles.dayButtonActive,
                      ]}
                      onPress={() => toggleDay(day)}
                    >
                      <Text
                        style={[
                          styles.dayButtonText,
                          reminderFormData.days?.includes(day) &&
                            styles.dayButtonTextActive,
                        ]}
                      >
                        {day}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>Label (Optional)</Text>
                <TextInput
                  style={styles.input}
                  value={reminderFormData.label}
                  onChangeText={(text) =>
                    setReminderFormData({ ...reminderFormData, label: text })
                  }
                  placeholder="e.g., Morning dose"
                  placeholderTextColor={Colors.textTertiary}
                />
              </View>

              <View style={styles.formGroup}>
                <View style={styles.switchContainer}>
                  <Text style={styles.label}>Sound</Text>
                  <Switch
                    value={reminderFormData.sound}
                    onValueChange={(value) =>
                      setReminderFormData({ ...reminderFormData, sound: value })
                    }
                    trackColor={{ false: Colors.border, true: Colors.primary }}
                    thumbColor={Colors.surface}
                  />
                </View>
              </View>

              <View style={styles.formGroup}>
                <View style={styles.switchContainer}>
                  <Text style={styles.label}>Vibrate</Text>
                  <Switch
                    value={reminderFormData.vibrate}
                    onValueChange={(value) =>
                      setReminderFormData({
                        ...reminderFormData,
                        vibrate: value,
                      })
                    }
                    trackColor={{ false: Colors.border, true: Colors.primary }}
                    thumbColor={Colors.surface}
                  />
                </View>
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => {
                  setReminderModalVisible(false);
                  setSelectedMedicationForReminder(null);
                }}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.saveButton]}
                onPress={handleSaveReminder}
              >
                <Text style={styles.saveButtonText}>Save Reminder</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "bold",
    color: Colors.text,
  },
  headerButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  headerButton: {
    padding: 4,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    marginHorizontal: 20,
    marginBottom: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 16,
    color: Colors.text,
    padding: 4,
  },
  tabContainer: {
    flexDirection: "row",
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: Colors.border,
  },
  activeTab: {
    borderBottomColor: Colors.primary,
  },
  tabText: {
    fontSize: 16,
    color: Colors.textSecondary,
    fontWeight: "500",
  },
  activeTabText: {
    color: Colors.primary,
    fontWeight: "600",
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  medicationsList: {
    paddingBottom: 20,
  },
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
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  activeBadge: {
    backgroundColor: Colors.success + "20",
  },
  inactiveBadge: {
    backgroundColor: Colors.textTertiary + "20",
  },
  statusText: {
    fontSize: 10,
    fontWeight: "600",
    color: Colors.text,
  },
  actionButtons: {
    flexDirection: "row",
    gap: 12,
  },
  medicationDosage: {
    fontSize: 14,
    color: Colors.primary,
    fontWeight: "500",
    marginBottom: 12,
  },
  medicationDetails: {
    gap: 8,
  },
  detailItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  detailText: {
    fontSize: 14,
    color: Colors.textSecondary,
    flex: 1,
  },
  refillBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.warning + "10",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: "flex-start",
    gap: 4,
    marginTop: 4,
  },
  refillText: {
    fontSize: 12,
    color: Colors.warning,
    fontWeight: "500",
  },
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
  reminderBadgeText: {
    fontSize: 12,
    color: Colors.primary,
    fontWeight: "500",
  },
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
  emptyStateText: {
    fontSize: 16,
    color: Colors.textTertiary,
    marginTop: 16,
    marginBottom: 20,
  },
  emptyStateButton: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
  },
  emptyStateButtonText: {
    color: Colors.surface,
    fontSize: 16,
    fontWeight: "600",
  },
  remindersList: {
    paddingBottom: 20,
  },
  reminderCard: {
    flexDirection: "row",
    alignItems: "center",
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
  reminderLeft: {
    marginRight: 12,
  },
  reminderCenter: {
    flex: 1,
  },
  reminderTime: {
    fontSize: 20,
    fontWeight: "bold",
    color: Colors.text,
    marginBottom: 4,
  },
  reminderMedName: {
    fontSize: 14,
    color: Colors.primary,
    fontWeight: "500",
    marginBottom: 2,
  },
  reminderDays: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  reminderDaysText: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  reminderLabel: {
    backgroundColor: Colors.primary + "10",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  reminderLabelText: {
    fontSize: 10,
    color: Colors.primary,
    fontWeight: "500",
  },
  reminderFeatures: {
    flexDirection: "row",
    gap: 8,
  },
  reminderRight: {
    flexDirection: "row",
    gap: 12,
  },
  reminderAction: {
    padding: 4,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: "90%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: Colors.text,
  },
  formGroup: {
    marginBottom: 16,
  },
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
  textArea: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  switchContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  modalFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 20,
    gap: 12,
  },
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
  saveButton: {
    backgroundColor: Colors.primary,
  },
  cancelButtonText: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: "600",
  },
  saveButtonText: {
    color: Colors.surface,
    fontSize: 16,
    fontWeight: "600",
  },
  medicationSelectorItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  selectorMedName: {
    fontSize: 16,
    fontWeight: "500",
    color: Colors.text,
    marginBottom: 4,
  },
  selectorMedDosage: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  selectedMedicationInfo: {
    backgroundColor: Colors.primary + "10",
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
  },
  selectedMedicationName: {
    fontSize: 16,
    color: Colors.primary,
    fontWeight: "600",
  },
  timePickerContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  timeInput: {
    flex: 1,
  },
  daysContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 4,
  },
  dayButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dayButtonActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  dayButtonText: {
    fontSize: 12,
    color: Colors.text,
  },
  dayButtonTextActive: {
    color: Colors.surface,
  },
});
