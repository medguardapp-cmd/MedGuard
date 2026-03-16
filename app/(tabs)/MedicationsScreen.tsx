// app/(tabs)/medications.tsx
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
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
import { auth, db } from "../../lib/firebase";
import {
  AICommunityReport,
  AIInteraction,
  AIProfileWarning,
  AISideEffect,
  generateReactionsAnalysis,
  ReactionsAnalysis,
} from "../../lib/openaiService";
import {
  removeReminderFromTodaySnapshot,
  upsertReminderSnapshot,
} from "../../lib/scheduleSnapshot";
import {
  checkAllInteractions,
  MedicineSearchResult,
  searchMedicines,
} from "../../lib/supabase";
import { tabEvents } from "../../lib/tabEvents";
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
  quantity: number;
  refillReminder: boolean;
  refillThreshold?: number;
  active: boolean;
  notes?: string;
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
  sound: boolean;
  vibrate: boolean;
  label?: string;
}

interface InteractionWarning {
  drug_id: string;
  interacts_with: string;
  interacts_name: string;
  description: string;
}

interface KnownSideEffect {
  medicationId: string;
  medicationName: string;
  toxicity: string | null;
  pharmacodynamics: string | null;
}

interface SymptomLog {
  id: string;
  symptom: string;
  severity: number;
  note?: string;
  medication_ids: string[];
  logged_at: any;
}

// ─────────────────────────────────────────────
// Helpers for AI reactions tab
// ─────────────────────────────────────────────
const warningColor = (severity: "info" | "caution" | "danger") => {
  if (severity === "danger") return Colors.error;
  if (severity === "caution") return Colors.warning;
  return Colors.primary;
};

const interactionColor = (severity: "mild" | "moderate" | "severe") => {
  if (severity === "severe") return Colors.error;
  if (severity === "moderate") return Colors.warning;
  return Colors.success;
};

export default function MedicationsScreen() {
  // ─── State ───────────────────────────────────
  const [medications, setMedications] = useState<Medication[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalVisible, setModalVisible] = useState(false);
  const [reminderModalVisible, setReminderModalVisible] = useState(false);
  const [editingMedication, setEditingMedication] = useState<Medication | null>(
    null,
  );
  const [editingReminder, setEditingReminder] = useState<Reminder | null>(null);
  const [activeTab, setActiveTab] = useState<
    "medications" | "reminders" | "reactions"
  >("medications");
  const [searchQuery, setSearchQuery] = useState("");

  const [searchResults, setSearchResults] = useState<MedicineSearchResult[]>(
    [],
  );
  const [isSearching, setIsSearching] = useState(false);
  const [selectedMedicine, setSelectedMedicine] =
    useState<MedicineSearchResult | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const [interactionWarnings, setInteractionWarnings] = useState<
    InteractionWarning[]
  >([]);
  const [interactionModalVisible, setInteractionModalVisible] = useState(false);
  const [pendingMedication, setPendingMedication] =
    useState<Partial<Medication> | null>(null);

  const [formData, setFormData] = useState<Partial<Medication>>({
    name: "",
    dosage: "",
    quantity: 0,
    refillReminder: false,
    active: true,
  });

  const [reminderFormData, setReminderFormData] = useState<Partial<Reminder>>({
    time: "08:00",
    days: [],
    enabled: true,
    sound: true,
    vibrate: true,
  });

  const [selectedMedicationForReminder, setSelectedMedicationForReminder] =
    useState<Medication | null>(null);
  const [showMedicationSelector, setShowMedicationSelector] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  // ─── Reactions tab state (UPDATED) ───────────
  const [aiAnalysis, setAiAnalysis] = useState<ReactionsAnalysis | null>(null);
  const [symptomLogs, setSymptomLogs] = useState<SymptomLog[]>([]);
  const [loadingReactions, setLoadingReactions] = useState(false);
  const [reactionsLoaded, setReactionsLoaded] = useState(false);
  const [reactionsError, setReactionsError] = useState<string | null>(null);

  // Log symptom modal state
  const [logModalVisible, setLogModalVisible] = useState(false);
  const [logForm, setLogForm] = useState({
    symptom: "",
    severity: 3,
    note: "",
    medication_ids: [] as string[],
  });

  const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const severityLabels = [
    "",
    "Mild",
    "Moderate",
    "Noticeable",
    "Severe",
    "Extreme",
  ];
  const severityColors = [
    "",
    Colors.success,
    Colors.success,
    Colors.warning,
    Colors.error,
    Colors.error,
  ];
  useEffect(() => {
    const cleanups = [
      tabEvents.on("openReactions", () => setActiveTab("reactions")),
      tabEvents.on("openAddMedication", () => handleAddMedication()),
      tabEvents.on("openAddReminder", () => handleAddReminder()),
      tabEvents.on("openLogReaction", () => setLogModalVisible(true)),
    ];
    return () => cleanups.forEach((c) => c());
  }, []);
  // ─── Firebase: Load medications + reminders ───
  useEffect(() => {
    const userId = auth.currentUser?.uid;
    if (!userId) return;

    const medsQuery = query(
      collection(db, "users", userId, "medications"),
      orderBy("createdAt", "desc"),
    );

    const unsubscribeMeds = onSnapshot(
      medsQuery,
      (snapshot) => {
        const meds = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as Medication[];
        setMedications(meds);
        setLoading(false);
        setReactionsLoaded(false);
      },
      (error) => {
        console.error("Firestore error:", error);
        setLoading(false);
      },
    );

    const unsubscribeReminders = onSnapshot(
      collection(db, "users", userId, "reminders"),
      (snapshot) => {
        const rems = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as Reminder[];
        setReminders(rems);
      },
    );

    const unsubscribeLogs = onSnapshot(
      query(
        collection(db, "users", userId, "symptom_logs"),
        orderBy("logged_at", "desc"),
      ),
      (snapshot) => {
        const logs = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as SymptomLog[];
        setSymptomLogs(logs);
      },
    );

    return () => {
      unsubscribeMeds();
      unsubscribeReminders();
      unsubscribeLogs();
    };
  }, []);

  // ─── Load reactions when tab is opened ────────
  useEffect(() => {
    if (activeTab === "reactions" && !reactionsLoaded) {
      loadReactionsData();
    }
  }, [activeTab, reactionsLoaded]);

  // ─── loadReactionsData (UPDATED — uses AI) ────
  const loadReactionsData = async () => {
    const userId = auth.currentUser?.uid;
    if (!userId) return;

    setLoadingReactions(true);
    setReactionsError(null);

    const activeMeds = medications.filter((m) => m.active);
    if (!activeMeds.length) {
      setAiAnalysis(null);
      setLoadingReactions(false);
      setReactionsLoaded(true);
      return;
    }

    try {
      const analysis = await generateReactionsAnalysis(userId, activeMeds);
      setAiAnalysis(analysis);
    } catch (err: any) {
      setReactionsError(
        err.message || "Failed to generate analysis. Please try again.",
      );
    } finally {
      setLoadingReactions(false);
      setReactionsLoaded(true);
    }
  };

  // ─── Log symptom ──────────────────────────────
  const handleLogSymptom = async () => {
    if (!logForm.symptom.trim()) {
      Alert.alert("Error", "Please enter a symptom");
      return;
    }

    const userId = auth.currentUser?.uid;
    if (!userId) return;

    try {
      await addDoc(collection(db, "users", userId, "symptom_logs"), {
        symptom: logForm.symptom.trim(),
        severity: logForm.severity,
        note: logForm.note.trim() || null,
        medication_ids: logForm.medication_ids,
        logged_at: serverTimestamp(),
      });

      setLogModalVisible(false);
      setLogForm({ symptom: "", severity: 3, note: "", medication_ids: [] });
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to log symptom");
    }
  };

  const handleDeleteSymptomLog = (id: string) => {
    Alert.alert("Delete Log", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          const userId = auth.currentUser?.uid;
          if (!userId) return;
          await deleteDoc(doc(db, "users", userId, "symptom_logs", id));
        },
      },
    ]);
  };

  const toggleMedForLog = (medId: string) => {
    setLogForm((prev) => ({
      ...prev,
      medication_ids: prev.medication_ids.includes(medId)
        ? prev.medication_ids.filter((id) => id !== medId)
        : [...prev.medication_ids, medId],
    }));
  };

  // ─── Time picker helpers ──────────────────────
  const timeStringToDate = (time: string) => {
    const [hours, minutes] = time.split(":").map(Number);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date;
  };

  const dateToTimeString = (date: Date) => {
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
  };

  // ─── Supabase: Search medicines ───────────────
  const handleMedicineSearch = useCallback(async (text: string) => {
    setFormData((prev) => ({ ...prev, name: text }));
    setSelectedMedicine(null);
    if (text.length < 2) {
      setSearchResults([]);
      setShowSuggestions(false);
      return;
    }
    setIsSearching(true);
    setShowSuggestions(true);
    const results = await searchMedicines(text);
    setSearchResults(results);
    setIsSearching(false);
  }, []);

  const handleSelectMedicine = (medicine: MedicineSearchResult) => {
    setSelectedMedicine(medicine);
    setFormData((prev) => ({
      ...prev,
      name: medicine.ph_brand,
      generic_name: medicine.generic_name,
      drug_id: medicine.drug_id,
      drug_ids: medicine.drug_ids,
      ingredients: medicine.ingredients,
      is_combination: medicine.is_combination,
    }));
    setShowSuggestions(false);
    setSearchResults([]);
  };

  // ─── Add/Edit medication ──────────────────────
  const handleAddMedication = () => {
    setEditingMedication(null);
    setSelectedMedicine(null);
    setFormData({
      name: "",
      dosage: "",
      quantity: 0,
      refillReminder: false,
      active: true,
    });
    setSearchResults([]);
    setShowSuggestions(false);
    setModalVisible(true);
  };

  const handleEditMedication = (medication: Medication) => {
    setEditingMedication(medication);
    setFormData(medication);
    setSelectedMedicine(null);
    setShowSuggestions(false);
    setModalVisible(true);
  };

  const handleSaveMedication = async () => {
    if (!formData.name || !formData.dosage) {
      Alert.alert("Error", "Please fill in all required fields");
      return;
    }
    const userId = auth.currentUser?.uid;
    if (!userId) return;

    if (!editingMedication && formData.drug_id) {
      const existingDrugIds = medications
        .filter((m) => m.drug_id && m.active)
        .map((m) => m.drug_id);
      if (existingDrugIds.length > 0) {
        const warnings = await checkAllInteractions(
          formData.drug_id,
          existingDrugIds,
        );
        if (warnings.length > 0) {
          setInteractionWarnings(warnings);
          setPendingMedication(formData);
          setModalVisible(false);
          setInteractionModalVisible(true);
          return;
        }
      }
    }
    await saveMedicationToFirestore(formData);
  };

  const saveMedicationToFirestore = async (data: Partial<Medication>) => {
    const userId = auth.currentUser?.uid;
    if (!userId) return;
    try {
      if (editingMedication) {
        await updateDoc(
          doc(db, "users", userId, "medications", editingMedication.id),
          { ...data, updatedAt: serverTimestamp() },
        );
      } else {
        const newMed = {
          drug_id: data.drug_id || null,
          drug_ids: data.drug_ids || [],
          name: data.name || "",
          generic_name: data.generic_name || "",
          dosage: data.dosage || "",
          quantity: data.quantity || 0,
          refillReminder: data.refillReminder || false,
          refillThreshold: data.refillThreshold || null,
          active: true,
          notes: data.notes || null,
          is_combination: data.is_combination || false,
          ingredients: data.ingredients || [],
          createdAt: serverTimestamp(),
        };
        const docRef = await addDoc(
          collection(db, "users", userId, "medications"),
          newMed,
        );
        Alert.alert(
          "Add Reminder",
          "Would you like to set up a reminder for this medication?",
          [
            { text: "Not Now", style: "cancel" },
            {
              text: "Add Reminder",
              onPress: () => {
                const med = { ...newMed, id: docRef.id } as Medication;
                setSelectedMedicationForReminder(med);
                setReminderFormData({
                  medicationId: docRef.id,
                  medicationName: newMed.name,
                  medicationDosage: newMed.dosage,
                  time: "08:00",
                  days: [],
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
      setInteractionModalVisible(false);
      setPendingMedication(null);
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to save medication");
    }
  };

  const handleDeleteMedication = (id: string) => {
    Alert.alert(
      "Delete Medication",
      "Are you sure? Associated reminders will also be deleted.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            const userId = auth.currentUser?.uid;
            if (!userId) return;
            try {
              await deleteDoc(doc(db, "users", userId, "medications", id));
              const remindersToDelete = reminders.filter(
                (r) => r.medicationId === id,
              );
              if (remindersToDelete.length > 0) {
                const batch = writeBatch(db);
                remindersToDelete.forEach((r) =>
                  batch.delete(doc(db, "users", userId, "reminders", r.id)),
                );
                await batch.commit();
              }
            } catch (error: any) {
              Alert.alert("Error", error.message || "Failed to delete");
            }
          },
        },
      ],
    );
  };

  // ─── Reminder handlers ────────────────────────
  const handleAddReminder = () => {
    setEditingReminder(null);
    setSelectedMedicationForReminder(null);
    setReminderFormData({
      time: "08:00",
      days: [],
      enabled: true,
      sound: true,
      vibrate: true,
    });
    setShowMedicationSelector(true);
  };

  const handleEditReminder = (reminder: Reminder) => {
    setEditingReminder(reminder);
    setReminderFormData(reminder);
    setSelectedMedicationForReminder(
      medications.find((m) => m.id === reminder.medicationId) || null,
    );
    setReminderModalVisible(true);
  };

  const handleDeleteReminder = (id: string) => {
    Alert.alert("Delete Reminder", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          const userId = auth.currentUser?.uid;
          if (!userId) return;
          await deleteDoc(doc(db, "users", userId, "reminders", id));
          // Remove from TODAY's snapshot only — past snapshots are preserved as history
          await removeReminderFromTodaySnapshot(userId, id).catch(console.warn);
        },
      },
    ]);
  };

  const handleToggleReminder = async (id: string) => {
    const userId = auth.currentUser?.uid;
    if (!userId) return;
    const reminder = reminders.find((r) => r.id === id);
    if (!reminder) return;
    await updateDoc(doc(db, "users", userId, "reminders", id), {
      enabled: !reminder.enabled,
    });
  };

  const handleSaveReminder = async () => {
    if (!selectedMedicationForReminder) {
      Alert.alert("Error", "Please select a medication");
      return;
    }
    const userId = auth.currentUser?.uid;
    if (!userId) return;
    const reminderData = {
      medicationId: selectedMedicationForReminder.id,
      medicationName: selectedMedicationForReminder.name,
      medicationDosage: selectedMedicationForReminder.dosage,
      time: reminderFormData.time || "08:00",
      days: reminderFormData.days || [],
      enabled: reminderFormData.enabled !== false,
      sound: reminderFormData.sound !== false,
      vibrate: reminderFormData.vibrate !== false,
      label: reminderFormData.label || null,
    };
    try {
      let savedReminderId = editingReminder?.id ?? "";
      if (editingReminder) {
        await updateDoc(
          doc(db, "users", userId, "reminders", editingReminder.id),
          reminderData,
        );
        savedReminderId = editingReminder.id;
      } else {
        const docRef = await addDoc(
          collection(db, "users", userId, "reminders"),
          reminderData,
        );
        savedReminderId = docRef.id;
      }
      // Write this reminder into today's schedule_snapshot
      await upsertReminderSnapshot(userId, {
        id: savedReminderId,
        medicationId: reminderData.medicationId,
        medicationName: reminderData.medicationName,
        medicationDosage: reminderData.medicationDosage,
        time: reminderData.time,
        days: reminderData.days,
        enabled: reminderData.enabled,
        sound: reminderData.sound,
        vibrate: reminderData.vibrate,
      }).catch(console.warn);
      setReminderModalVisible(false);
      setShowMedicationSelector(false);
      setSelectedMedicationForReminder(null);
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to save reminder");
    }
  };

  const selectMedication = (medication: Medication) => {
    setSelectedMedicationForReminder(medication);
    setReminderFormData((prev) => ({
      ...prev,
      medicationId: medication.id,
      medicationName: medication.name,
      medicationDosage: medication.dosage,
    }));
    setShowMedicationSelector(false);
    setReminderModalVisible(true);
  };

  const toggleDay = (day: string) => {
    const currentDays = reminderFormData.days || [];
    setReminderFormData({
      ...reminderFormData,
      days: currentDays.includes(day)
        ? currentDays.filter((d) => d !== day)
        : [...currentDays, day],
    });
  };

  // ─── Helpers ──────────────────────────────────
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

  const formatLogDate = (timestamp: any) => {
    if (!timestamp) return "";
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString("en-PH", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const filteredMedications = medications.filter(
    (med) =>
      med.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      med.dosage.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const sortedReminders = [...reminders].sort((a, b) =>
    a.time.localeCompare(b.time),
  );

  // ─── Render ───────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading medications...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Medications</Text>
        <View style={styles.headerButtons}>
          {activeTab === "reactions" && (
            <TouchableOpacity
              style={styles.headerButton}
              onPress={() => setLogModalVisible(true)}
            >
              <Ionicons name="add-circle" size={28} color={Colors.primary} />
            </TouchableOpacity>
          )}
          {activeTab !== "reactions" && (
            <>
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
            </>
          )}
        </View>
      </View>

      {/* Search Bar — only on medications tab */}
      {activeTab === "medications" && (
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
      )}

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
            Reminders
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === "reactions" && styles.activeTab]}
          onPress={() => setActiveTab("reactions")}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === "reactions" && styles.activeTabText,
            ]}
          >
            Reactions
          </Text>
          {/* UPDATED: badge now shows AI interaction count */}
          {(aiAnalysis?.interactions?.length ?? 0) > 0 && (
            <View style={styles.tabBadge}>
              <Text style={styles.tabBadgeText}>
                {aiAnalysis!.interactions.length}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 55 }}
      >
        {/* ── Medications Tab ── */}
        {activeTab === "medications" && (
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

                  {medication.generic_name &&
                    medication.generic_name !== medication.name && (
                      <Text style={styles.genericName}>
                        {medication.generic_name}
                      </Text>
                    )}

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
                    {medication.is_combination && (
                      <View style={styles.combinationBadge}>
                        <Ionicons
                          name="layers"
                          size={14}
                          color={Colors.primary}
                        />
                        <Text style={styles.combinationText}>
                          {medication.ingredients?.join(" + ")}
                        </Text>
                      </View>
                    )}
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

                  <TouchableOpacity
                    style={styles.quickAddReminder}
                    onPress={() => {
                      setSelectedMedicationForReminder(medication);
                      setReminderFormData({
                        medicationId: medication.id,
                        medicationName: medication.name,
                        medicationDosage: medication.dosage,
                        time: "08:00",
                        days: [],
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
        )}

        {/* ── Reminders Tab ── */}
        {activeTab === "reminders" && (
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

        {/* ── Reactions Tab (UPDATED) ── */}
        {activeTab === "reactions" && (
          <View>
            {loadingReactions ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={Colors.primary} />
                <Text style={styles.loadingText}>
                  Analyzing your medications with AI...
                </Text>
                <Text
                  style={[styles.loadingText, { fontSize: 13, marginTop: 4 }]}
                >
                  Checking your profile, community reports, and interactions
                </Text>
              </View>
            ) : reactionsError ? (
              <View style={styles.reactionEmptyCard}>
                <Ionicons
                  name="warning-outline"
                  size={32}
                  color={Colors.error}
                />
                <Text
                  style={[styles.reactionEmptyText, { color: Colors.error }]}
                >
                  {reactionsError}
                </Text>
                <TouchableOpacity
                  style={styles.emptyStateButton}
                  onPress={loadReactionsData}
                >
                  <Text style={styles.emptyStateButtonText}>Try Again</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                {/* AI header + refresh */}
                <View style={[styles.sectionHeader, { marginTop: 0 }]}>
                  <Ionicons name="sparkles" size={20} color={Colors.primary} />
                  <Text style={styles.sectionTitle}>AI Analysis</Text>
                  <TouchableOpacity
                    onPress={() => setReactionsLoaded(false)}
                    style={styles.refreshButton}
                  >
                    <Ionicons name="refresh" size={18} color={Colors.primary} />
                  </TouchableOpacity>
                  {aiAnalysis && (
                    <Text style={{ fontSize: 11, color: Colors.textTertiary }}>
                      {aiAnalysis.lastUpdated.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Text>
                  )}
                </View>

                {/* Overall summary */}
                {aiAnalysis?.summary ? (
                  <View
                    style={[
                      styles.interactionCard,
                      { borderLeftColor: Colors.primary, marginBottom: 16 },
                    ]}
                  >
                    <Text style={styles.interactionDescription}>
                      {aiAnalysis.summary}
                    </Text>
                  </View>
                ) : !aiAnalysis ? (
                  <View style={styles.reactionEmptyCard}>
                    <Ionicons
                      name="medical-outline"
                      size={32}
                      color={Colors.textTertiary}
                    />
                    <Text style={styles.reactionEmptyText}>
                      Add medications to see your AI analysis
                    </Text>
                  </View>
                ) : null}

                {/* Profile Warnings */}
                {(aiAnalysis?.profileWarnings?.length ?? 0) > 0 && (
                  <>
                    <View style={styles.sectionHeader}>
                      <Ionicons
                        name="alert-circle"
                        size={20}
                        color={Colors.error}
                      />
                      <Text style={styles.sectionTitle}>Profile Warnings</Text>
                    </View>
                    {aiAnalysis!.profileWarnings.map(
                      (w: AIProfileWarning, i: number) => (
                        <View
                          key={i}
                          style={[
                            styles.interactionCard,
                            {
                              borderLeftColor: warningColor(w.severity),
                              marginBottom: 8,
                            },
                          ]}
                        >
                          <View style={styles.interactionDrugs}>
                            <Ionicons
                              name={
                                w.severity === "danger"
                                  ? "warning"
                                  : w.severity === "caution"
                                    ? "alert-circle"
                                    : "information-circle"
                              }
                              size={16}
                              color={warningColor(w.severity)}
                            />
                            <Text
                              style={[
                                styles.interactionDrugName,
                                {
                                  color: warningColor(w.severity),
                                  textTransform: "capitalize",
                                },
                              ]}
                            >
                              {w.type} warning
                            </Text>
                          </View>
                          <Text style={styles.interactionDescription}>
                            {w.warning}
                          </Text>
                        </View>
                      ),
                    )}
                  </>
                )}

                {/* Drug Interactions */}
                <View style={styles.sectionHeader}>
                  <Ionicons name="git-compare" size={20} color={Colors.error} />
                  <Text style={styles.sectionTitle}>Drug Interactions</Text>
                  <TouchableOpacity
                    onPress={loadReactionsData}
                    style={styles.refreshButton}
                  >
                    <Ionicons name="refresh" size={18} color={Colors.primary} />
                  </TouchableOpacity>
                </View>

                {(aiAnalysis?.interactions?.length ?? 0) > 0 ? (
                  aiAnalysis!.interactions.map(
                    (interaction: AIInteraction, index: number) => (
                      <View
                        key={index}
                        style={[
                          styles.interactionCard,
                          {
                            borderLeftColor: interactionColor(
                              interaction.severity,
                            ),
                            marginBottom: 10,
                          },
                        ]}
                      >
                        <View
                          style={[styles.interactionDrugs, { marginBottom: 6 }]}
                        >
                          <Text style={styles.interactionDrugName}>
                            {interaction.drugA}
                          </Text>
                          <Ionicons
                            name="swap-horizontal"
                            size={16}
                            color={Colors.textSecondary}
                          />
                          <Text style={styles.interactionDrugName}>
                            {interaction.drugB}
                          </Text>
                          <View
                            style={[
                              styles.statusBadge,
                              {
                                backgroundColor:
                                  interactionColor(interaction.severity) + "20",
                                marginLeft: "auto" as any,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.statusText,
                                {
                                  color: interactionColor(interaction.severity),
                                  textTransform: "capitalize",
                                },
                              ]}
                            >
                              {interaction.severity}
                            </Text>
                          </View>
                        </View>
                        <Text
                          style={[
                            styles.sideEffectLabel,
                            {
                              color: interactionColor(interaction.severity),
                              marginBottom: 4,
                            },
                          ]}
                        >
                          {interaction.severityReason}
                        </Text>
                        <Text style={styles.interactionDescription}>
                          {interaction.description}
                        </Text>
                        {interaction.recommendation ? (
                          <View
                            style={[
                              styles.refillBadge,
                              { marginTop: 8, alignSelf: "stretch" as any },
                            ]}
                          >
                            <Ionicons
                              name="bulb-outline"
                              size={14}
                              color={Colors.warning}
                            />
                            <Text style={[styles.refillText, { flex: 1 }]}>
                              {interaction.recommendation}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    ),
                  )
                ) : (
                  <View style={styles.reactionEmptyCard}>
                    <Ionicons
                      name="checkmark-circle"
                      size={32}
                      color={Colors.success}
                    />
                    <Text style={styles.reactionEmptyText}>
                      No known interactions between your current medications
                    </Text>
                  </View>
                )}

                {/* Side Effects */}
                <View style={styles.sectionHeader}>
                  <Ionicons name="warning" size={20} color={Colors.warning} />
                  <Text style={styles.sectionTitle}>Side Effects</Text>
                </View>

                {(aiAnalysis?.sideEffects?.length ?? 0) > 0 ? (
                  aiAnalysis!.sideEffects.map(
                    (item: AISideEffect, index: number) => (
                      <View
                        key={index}
                        style={[styles.sideEffectCard, { marginBottom: 12 }]}
                      >
                        <Text style={styles.sideEffectMedName}>
                          {item.medicationName}
                        </Text>
                        <Text
                          style={[styles.sideEffectText, { marginBottom: 10 }]}
                        >
                          {item.summary}
                        </Text>

                        {/* Per-medication profile warnings */}
                        {item.profileWarnings?.map(
                          (w: AIProfileWarning, wi: number) => (
                            <View
                              key={wi}
                              style={[
                                styles.warningCard,
                                {
                                  backgroundColor:
                                    warningColor(w.severity) + "12",
                                  borderLeftColor: warningColor(w.severity),
                                  marginBottom: 8,
                                },
                              ]}
                            >
                              <View style={styles.warningHeader}>
                                <Ionicons
                                  name={
                                    w.severity === "danger"
                                      ? "warning"
                                      : "alert-circle"
                                  }
                                  size={14}
                                  color={warningColor(w.severity)}
                                />
                                <Text
                                  style={[
                                    styles.warningDrugName,
                                    {
                                      fontSize: 13,
                                      color: warningColor(w.severity),
                                    },
                                  ]}
                                >
                                  {w.type.charAt(0).toUpperCase() +
                                    w.type.slice(1)}{" "}
                                  alert
                                </Text>
                              </View>
                              <Text
                                style={[
                                  styles.warningDescription,
                                  { fontSize: 12 },
                                ]}
                              >
                                {w.warning}
                              </Text>
                            </View>
                          ),
                        )}

                        {/* Common side effects */}
                        {item.common?.length > 0 && (
                          <View style={styles.sideEffectSection}>
                            <Text style={styles.sideEffectLabel}>Common</Text>
                            {item.common.map((se: string, si: number) => (
                              <View
                                key={si}
                                style={{
                                  flexDirection: "row",
                                  gap: 6,
                                  marginBottom: 3,
                                }}
                              >
                                <Text
                                  style={{
                                    color: Colors.warning,
                                    fontSize: 12,
                                  }}
                                >
                                  •
                                </Text>
                                <Text style={styles.sideEffectText}>{se}</Text>
                              </View>
                            ))}
                          </View>
                        )}

                        {/* Serious side effects */}
                        {item.serious?.length > 0 && (
                          <View style={styles.sideEffectSection}>
                            <Text
                              style={[
                                styles.sideEffectLabel,
                                { color: Colors.error },
                              ]}
                            >
                              Serious / Rare
                            </Text>
                            {item.serious.map((se: string, si: number) => (
                              <View
                                key={si}
                                style={{
                                  flexDirection: "row",
                                  gap: 6,
                                  marginBottom: 3,
                                }}
                              >
                                <Text
                                  style={{ color: Colors.error, fontSize: 12 }}
                                >
                                  •
                                </Text>
                                <Text style={styles.sideEffectText}>{se}</Text>
                              </View>
                            ))}
                          </View>
                        )}
                      </View>
                    ),
                  )
                ) : (
                  <View style={styles.reactionEmptyCard}>
                    <Text style={styles.reactionEmptyText}>
                      Add medications to see side effect analysis
                    </Text>
                  </View>
                )}

                {/* Community Reports */}
                <View style={styles.sectionHeader}>
                  <Ionicons name="people" size={20} color={Colors.primary} />
                  <Text style={styles.sectionTitle}>Community Reports</Text>
                </View>
                <View
                  style={[
                    styles.reactionEmptyCard,
                    { backgroundColor: Colors.primary + "08", marginBottom: 8 },
                  ]}
                >
                  <Ionicons
                    name="information-circle-outline"
                    size={16}
                    color={Colors.primary}
                  />
                  <Text
                    style={[
                      styles.reactionEmptyText,
                      { fontSize: 12, color: Colors.primary },
                    ]}
                  >
                    Anonymized reports from users with similar conditions. For
                    reference only — not medical advice.
                  </Text>
                </View>

                {(aiAnalysis?.communityReports?.length ?? 0) > 0 ? (
                  aiAnalysis!.communityReports.map(
                    (report: AICommunityReport, index: number) => (
                      <View
                        key={index}
                        style={[styles.logCard, { marginBottom: 8 }]}
                      >
                        <View style={styles.logTitleRow}>
                          <Text style={styles.logSymptom}>
                            {report.symptom}
                          </Text>
                          <View
                            style={[
                              styles.severityBadge,
                              { backgroundColor: Colors.textTertiary + "20" },
                            ]}
                          >
                            <Text
                              style={[
                                styles.severityText,
                                { color: Colors.textSecondary },
                              ]}
                            >
                              {report.reportCount} report
                              {report.reportCount !== 1 ? "s" : ""}
                            </Text>
                          </View>
                          <View
                            style={[
                              styles.severityBadge,
                              { backgroundColor: Colors.warning + "20" },
                            ]}
                          >
                            <Text
                              style={[
                                styles.severityText,
                                { color: Colors.warning },
                              ]}
                            >
                              avg {report.avgSeverity.toFixed(1)}/5
                            </Text>
                          </View>
                        </View>
                        {report.note ? (
                          <Text style={[styles.logNote, { marginTop: 6 }]}>
                            {report.note}
                          </Text>
                        ) : null}
                      </View>
                    ),
                  )
                ) : (
                  <View style={styles.reactionEmptyCard}>
                    <Ionicons
                      name="people-outline"
                      size={32}
                      color={Colors.textTertiary}
                    />
                    <Text style={styles.reactionEmptyText}>
                      No community data available yet for users with your
                      conditions
                    </Text>
                  </View>
                )}

                {/* My Symptom Log — unchanged */}
                <View style={styles.sectionHeader}>
                  <Ionicons name="clipboard" size={20} color={Colors.primary} />
                  <Text style={styles.sectionTitle}>My Symptom Log</Text>
                  <TouchableOpacity
                    onPress={() => setLogModalVisible(true)}
                    style={styles.addLogButton}
                  >
                    <Ionicons name="add" size={18} color={Colors.primary} />
                    <Text style={styles.addLogText}>Log</Text>
                  </TouchableOpacity>
                </View>

                {symptomLogs.length > 0 ? (
                  symptomLogs.map((log) => (
                    <View key={log.id} style={styles.logCard}>
                      <View style={styles.logHeader}>
                        <View style={styles.logTitleRow}>
                          <Text style={styles.logSymptom}>{log.symptom}</Text>
                          <View
                            style={[
                              styles.severityBadge,
                              {
                                backgroundColor:
                                  (severityColors[log.severity] ||
                                    Colors.textTertiary) + "20",
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.severityText,
                                {
                                  color:
                                    severityColors[log.severity] ||
                                    Colors.textTertiary,
                                },
                              ]}
                            >
                              {severityLabels[log.severity] || "Unknown"}
                            </Text>
                          </View>
                        </View>
                        <TouchableOpacity
                          onPress={() => handleDeleteSymptomLog(log.id)}
                        >
                          <Ionicons
                            name="trash-outline"
                            size={18}
                            color={Colors.error}
                          />
                        </TouchableOpacity>
                      </View>
                      {log.note && (
                        <Text style={styles.logNote}>{log.note}</Text>
                      )}
                      {log.medication_ids.length > 0 && (
                        <View style={styles.logMeds}>
                          <Ionicons
                            name="medical"
                            size={12}
                            color={Colors.textTertiary}
                          />
                          <Text style={styles.logMedsText}>
                            {log.medication_ids
                              .map(
                                (id) =>
                                  medications.find((m) => m.id === id)?.name ||
                                  id,
                              )
                              .join(", ")}
                          </Text>
                        </View>
                      )}
                      <Text style={styles.logDate}>
                        {formatLogDate(log.logged_at)}
                      </Text>
                    </View>
                  ))
                ) : (
                  <View style={styles.reactionEmptyCard}>
                    <Ionicons
                      name="clipboard-outline"
                      size={32}
                      color={Colors.textTertiary}
                    />
                    <Text style={styles.reactionEmptyText}>
                      No symptoms logged yet
                    </Text>
                    <TouchableOpacity
                      style={styles.emptyStateButton}
                      onPress={() => setLogModalVisible(true)}
                    >
                      <Text style={styles.emptyStateButtonText}>
                        Log a Symptom
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </>
            )}
          </View>
        )}
      </ScrollView>

      {/* ── Add/Edit Medication Modal ── */}
      <Modal
        animationType="slide"
        transparent
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
              contentContainerStyle={{ paddingBottom: 55 }}
            >
              <View style={styles.formGroup}>
                <Text style={styles.label}>Medication Name *</Text>
                <TextInput
                  style={styles.input}
                  value={formData.name}
                  onChangeText={handleMedicineSearch}
                  placeholder="Search brand or generic name..."
                  placeholderTextColor={Colors.textTertiary}
                  editable={!editingMedication}
                />
                {showSuggestions && (
                  <View style={styles.suggestionsContainer}>
                    {isSearching ? (
                      <View style={styles.suggestionLoading}>
                        <ActivityIndicator
                          size="small"
                          color={Colors.primary}
                        />
                        <Text style={styles.suggestionLoadingText}>
                          Searching...
                        </Text>
                      </View>
                    ) : searchResults.length > 0 ? (
                      <FlatList
                        data={searchResults}
                        keyExtractor={(item) => item.id}
                        scrollEnabled={false}
                        renderItem={({ item }) => (
                          <TouchableOpacity
                            style={styles.suggestionItem}
                            onPress={() => handleSelectMedicine(item)}
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
                        )}
                      />
                    ) : (
                      <View style={styles.suggestionEmpty}>
                        <Text style={styles.suggestionEmptyText}>
                          No medicines found
                        </Text>
                      </View>
                    )}
                  </View>
                )}
                {selectedMedicine && (
                  <View style={styles.selectedMedicineInfo}>
                    <Ionicons
                      name="checkmark-circle"
                      size={16}
                      color={Colors.success}
                    />
                    <Text style={styles.selectedMedicineText}>
                      {selectedMedicine.ph_brand}
                      {!selectedMedicine.is_generic &&
                        ` — ${selectedMedicine.generic_name}`}
                    </Text>
                  </View>
                )}
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

      {/* ── Interaction Warning Modal ── */}
      <Modal
        animationType="slide"
        transparent
        visible={interactionModalVisible}
        onRequestClose={() => setInteractionModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>⚠️ Interaction Warning</Text>
              <TouchableOpacity
                onPress={() => setInteractionModalVisible(false)}
              >
                <Ionicons name="close" size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>
            <Text style={styles.interactionIntro}>
              The following interactions were found with your current
              medications:
            </Text>
            <ScrollView
              showsVerticalScrollIndicator={false}
              style={{ maxHeight: 300 }}
            >
              {interactionWarnings.map((warning, index) => (
                <View key={index} style={styles.warningCard}>
                  <View style={styles.warningHeader}>
                    <Ionicons name="warning" size={18} color={Colors.warning} />
                    <Text style={styles.warningDrugName}>
                      {warning.interacts_name}
                    </Text>
                  </View>
                  <Text style={styles.warningDescription} numberOfLines={4}>
                    {warning.description}
                  </Text>
                </View>
              ))}
            </ScrollView>
            <Text style={styles.interactionNote}>
              Please consult your doctor or pharmacist before proceeding.
            </Text>
            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setInteractionModalVisible(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.warningButton]}
                onPress={() =>
                  pendingMedication &&
                  saveMedicationToFirestore(pendingMedication)
                }
              >
                <Text style={styles.saveButtonText}>Add Anyway</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Medication Selector Modal ── */}
      <Modal
        animationType="slide"
        transparent
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
              contentContainerStyle={{ paddingBottom: 55 }}
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

      {/* ── Add/Edit Reminder Modal ── */}
      <Modal
        animationType="slide"
        transparent
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
              contentContainerStyle={{ paddingBottom: 30 }}
            >
              <View style={styles.formGroup}>
                <Text style={styles.label}>Time</Text>
                <TouchableOpacity
                  style={styles.timePickerButton}
                  onPress={() => setShowTimePicker(true)}
                >
                  <Ionicons
                    name="time-outline"
                    size={20}
                    color={Colors.primary}
                  />
                  <Text style={styles.timePickerButtonText}>
                    {formatTime(reminderFormData.time || "08:00")}
                  </Text>
                  <Ionicons
                    name="chevron-down"
                    size={18}
                    color={Colors.textTertiary}
                  />
                </TouchableOpacity>
                {showTimePicker && (
                  <DateTimePicker
                    value={timeStringToDate(reminderFormData.time || "08:00")}
                    mode="time"
                    is24Hour={false}
                    display="default"
                    onChange={(
                      event: DateTimePickerEvent,
                      selectedDate?: Date,
                    ) => {
                      setShowTimePicker(false);
                      if (event.type === "dismissed" || !selectedDate) return;
                      setReminderFormData({
                        ...reminderFormData,
                        time: dateToTimeString(selectedDate),
                      });
                    }}
                  />
                )}
              </View>
              <View style={styles.formGroup}>
                <View style={styles.repeatLabelRow}>
                  <Text style={styles.label}>Repeat</Text>
                  {(!reminderFormData.days ||
                    reminderFormData.days.length === 0) && (
                    <View style={styles.oneTimeBadge}>
                      <Text style={styles.oneTimeBadgeText}>One-time</Text>
                    </View>
                  )}
                </View>
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

      {/* ── Log Symptom Modal ── */}
      <Modal
        animationType="slide"
        transparent
        visible={logModalVisible}
        onRequestClose={() => setLogModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Log a Symptom</Text>
              <TouchableOpacity onPress={() => setLogModalVisible(false)}>
                <Ionicons name="close" size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 30 }}
            >
              <View style={styles.formGroup}>
                <Text style={styles.label}>Symptom *</Text>
                <TextInput
                  style={styles.input}
                  value={logForm.symptom}
                  onChangeText={(text) =>
                    setLogForm({ ...logForm, symptom: text })
                  }
                  placeholder="e.g., headache, nausea, dizziness..."
                  placeholderTextColor={Colors.textTertiary}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>
                  Severity — {severityLabels[logForm.severity]}
                </Text>
                <View style={styles.severityContainer}>
                  {[1, 2, 3, 4, 5].map((level) => (
                    <TouchableOpacity
                      key={level}
                      style={[
                        styles.severityButton,
                        logForm.severity === level && {
                          backgroundColor: severityColors[level],
                          borderColor: severityColors[level],
                        },
                      ]}
                      onPress={() =>
                        setLogForm({ ...logForm, severity: level })
                      }
                    >
                      <Text
                        style={[
                          styles.severityButtonText,
                          logForm.severity === level &&
                            styles.severityButtonTextActive,
                        ]}
                      >
                        {level}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>Note (Optional)</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={logForm.note}
                  onChangeText={(text) =>
                    setLogForm({ ...logForm, note: text })
                  }
                  placeholder="Any additional details..."
                  placeholderTextColor={Colors.textTertiary}
                  multiline
                  numberOfLines={3}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>
                  Suspected Medication (Optional)
                </Text>
                <Text style={styles.subLabel}>
                  Tap to select which medication you think caused this
                </Text>
                {medications
                  .filter((m) => m.active)
                  .map((med) => (
                    <TouchableOpacity
                      key={med.id}
                      style={[
                        styles.medCheckItem,
                        logForm.medication_ids.includes(med.id) &&
                          styles.medCheckItemActive,
                      ]}
                      onPress={() => toggleMedForLog(med.id)}
                    >
                      <Ionicons
                        name={
                          logForm.medication_ids.includes(med.id)
                            ? "checkbox"
                            : "square-outline"
                        }
                        size={20}
                        color={
                          logForm.medication_ids.includes(med.id)
                            ? Colors.primary
                            : Colors.textTertiary
                        }
                      />
                      <Text style={styles.medCheckText}>
                        {med.name} {med.dosage}
                      </Text>
                    </TouchableOpacity>
                  ))}
              </View>
            </ScrollView>
            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setLogModalVisible(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.saveButton]}
                onPress={handleLogSymptom}
              >
                <Text style={styles.saveButtonText}>Log Symptom</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 40,
  },
  loadingText: { marginTop: 12, fontSize: 16, color: Colors.textSecondary },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  headerTitle: { fontSize: 28, fontWeight: "bold", color: Colors.text },
  headerButtons: { flexDirection: "row", alignItems: "center", gap: 16 },
  headerButton: { padding: 4 },
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
    position: "relative",
  },
  activeTab: { borderBottomColor: Colors.primary },
  tabText: { fontSize: 14, color: Colors.textSecondary, fontWeight: "500" },
  activeTabText: { color: Colors.primary, fontWeight: "600" },
  tabBadge: {
    position: "absolute",
    top: 4,
    right: 8,
    backgroundColor: Colors.error,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  tabBadgeText: { fontSize: 10, color: Colors.surface, fontWeight: "700" },
  content: { flex: 1, paddingHorizontal: 20 },
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
  genericName: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 8,
    fontStyle: "italic",
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
  medicationDetails: { gap: 8 },
  detailItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  detailText: { fontSize: 14, color: Colors.textSecondary, flex: 1 },
  combinationBadge: {
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
  combinationText: {
    fontSize: 12,
    color: Colors.primary,
    fontWeight: "500",
    flexShrink: 1,
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
  refillText: { fontSize: 12, color: Colors.warning, fontWeight: "500" },
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
  remindersList: { paddingBottom: 20 },
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
  reminderLeft: { marginRight: 12 },
  reminderCenter: { flex: 1 },
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
  reminderDaysText: { fontSize: 12, color: Colors.textSecondary },
  reminderLabel: {
    backgroundColor: Colors.primary + "10",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  reminderLabelText: { fontSize: 10, color: Colors.primary, fontWeight: "500" },
  reminderFeatures: { flexDirection: "row", gap: 8 },
  reminderRight: { flexDirection: "row", gap: 12 },
  reminderAction: { padding: 4 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 16,
    marginBottom: 10,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.text,
    flex: 1,
  },
  refreshButton: { padding: 4 },
  addLogButton: { flexDirection: "row", alignItems: "center", gap: 4 },
  addLogText: { fontSize: 14, color: Colors.primary, fontWeight: "600" },
  interactionCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderLeftWidth: 3,
    borderLeftColor: Colors.error,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  interactionDrugs: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
    flexWrap: "wrap",
  },
  interactionDrugName: { fontSize: 14, fontWeight: "700", color: Colors.text },
  interactionDescription: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  sideEffectCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderLeftWidth: 3,
    borderLeftColor: Colors.warning,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  sideEffectMedName: {
    fontSize: 15,
    fontWeight: "700",
    color: Colors.text,
    marginBottom: 8,
  },
  sideEffectSection: { marginBottom: 8 },
  sideEffectLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: Colors.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  sideEffectText: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  sideEffectEmpty: {
    fontSize: 13,
    color: Colors.textTertiary,
    fontStyle: "italic",
  },
  reactionEmptyCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 20,
    alignItems: "center",
    marginBottom: 10,
    gap: 8,
  },
  reactionEmptyText: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: "center",
  },
  logCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  logHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 6,
  },
  logTitleRow: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  logSymptom: { fontSize: 15, fontWeight: "700", color: Colors.text },
  severityBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  severityText: { fontSize: 11, fontWeight: "600" },
  logNote: { fontSize: 13, color: Colors.textSecondary, marginBottom: 6 },
  logMeds: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 4,
  },
  logMedsText: { fontSize: 12, color: Colors.textTertiary, flex: 1 },
  logDate: { fontSize: 11, color: Colors.textTertiary },
  severityContainer: { flexDirection: "row", gap: 8, marginTop: 4 },
  severityButton: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  severityButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.textSecondary,
  },
  severityButtonTextActive: { color: Colors.surface },
  subLabel: { fontSize: 12, color: Colors.textTertiary, marginBottom: 8 },
  medCheckItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  medCheckItemActive: {
    backgroundColor: Colors.primary + "08",
    borderRadius: 8,
    paddingHorizontal: 8,
  },
  medCheckText: { fontSize: 14, color: Colors.text },
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
  textArea: { minHeight: 80, textAlignVertical: "top" },
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
  saveButton: { backgroundColor: Colors.primary },
  warningButton: { backgroundColor: Colors.warning },
  cancelButtonText: { color: Colors.text, fontSize: 16, fontWeight: "600" },
  saveButtonText: { color: Colors.surface, fontSize: 16, fontWeight: "600" },
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
  selectorMedDosage: { fontSize: 14, color: Colors.textSecondary },
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
  dayButtonText: { fontSize: 12, color: Colors.text },
  dayButtonTextActive: { color: Colors.surface },
  timePickerButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  timePickerButtonText: {
    flex: 1,
    fontSize: 16,
    color: Colors.text,
    fontWeight: "500",
  },
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
  selectedMedicineInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
  },
  selectedMedicineText: {
    fontSize: 13,
    color: Colors.success,
    fontWeight: "500",
    flex: 1,
  },
  interactionIntro: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 12,
  },
  warningCard: {
    backgroundColor: Colors.warning + "10",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: Colors.warning,
  },
  warningHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  warningDrugName: { fontSize: 15, fontWeight: "600", color: Colors.text },
  warningDescription: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  interactionNote: {
    fontSize: 13,
    color: Colors.error,
    fontWeight: "500",
    marginTop: 12,
    marginBottom: 4,
  },
  repeatLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  oneTimeBadge: {
    backgroundColor: Colors.primary + "15",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  oneTimeBadgeText: {
    fontSize: 11,
    color: Colors.primary,
    fontWeight: "600",
  },
});
