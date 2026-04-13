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
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
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
import { auth, db } from "../../lib/firebase";
import { generateReactionsAnalysis } from "../../lib/openaiService";
import {
  MedicineSearchResult,
  checkAllInteractions,
  searchMedicines,
} from "../../lib/supabase";
import { MedicationsTab } from "./MedicationsTab";
import { ReactionsTab } from "./ReactionsTab";
import { RemindersTab } from "./RemindersTab";

// Types
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
  times: string[];
  days: string[];
  enabled: boolean;
  sound: boolean;
  vibrate: boolean;
  label?: string;
  durationType?: "none" | "date-range" | "until-empty";
  startDate?: string;
  endDate?: string;
  scheduledDate?: string;
  createdAt?: any;
}

interface SymptomLog {
  id: string;
  symptom: string;
  severity: number;
  note?: string;
  medication_ids: string[];
  logged_at: any;
}

interface InteractionWarning {
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

// Helper function to normalize dates
const normalizeDate = (date: Date): Date => {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
};

export default function MedicationsScreen() {
  const [medications, setMedications] = useState<Medication[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [symptomLogs, setSymptomLogs] = useState<SymptomLog[]>([]);
  const [takenLogs, setTakenLogs] = useState<TakenLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<
    "medications" | "reminders" | "reactions"
  >("medications");
  const [searchQuery, setSearchQuery] = useState("");

  // AI Analysis state
  const [aiAnalysis, setAiAnalysis] = useState<any>(null);
  const [loadingReactions, setLoadingReactions] = useState(false);
  const [reactionsLoaded, setReactionsLoaded] = useState(false);
  const [reactionsError, setReactionsError] = useState<string | null>(null);

  // Modal states
  const [medicationModalVisible, setMedicationModalVisible] = useState(false);
  const [reminderModalVisible, setReminderModalVisible] = useState(false);
  const [logModalVisible, setLogModalVisible] = useState(false);
  const [interactionModalVisible, setInteractionModalVisible] = useState(false);

  // Editing states
  const [editingMedication, setEditingMedication] = useState<Medication | null>(
    null,
  );
  const [editingReminder, setEditingReminder] = useState<Reminder | null>(null);
  const [selectedMedicationForReminder, setSelectedMedicationForReminder] =
    useState<Medication | null>(null);

  // Form states
  const [medicationForm, setMedicationForm] = useState<Partial<Medication>>({
    name: "",
    dosage: "",
    quantity: 0,
    refillReminder: false,
    active: true,
    notes: "",
  });

  const [reminderForm, setReminderForm] = useState<Partial<Reminder>>({
    times: ["08:00"],
    days: [],
    enabled: true,
    sound: true,
    vibrate: true,
    durationType: "none",
    startDate: "",
    endDate: "",
  });

  const [logForm, setLogForm] = useState({
    symptom: "",
    severity: 3,
    note: "",
    medication_ids: [] as string[],
  });

  // Search states for medication modal
  const [searchResults, setSearchResults] = useState<MedicineSearchResult[]>(
    [],
  );
  const [isSearching, setIsSearching] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedMedicine, setSelectedMedicine] =
    useState<MedicineSearchResult | null>(null);

  // Interaction warning states
  const [interactionWarnings, setInteractionWarnings] = useState<
    InteractionWarning[]
  >([]);
  const [pendingMedication, setPendingMedication] =
    useState<Partial<Medication> | null>(null);

  // Time picker states
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  const [editingTimeIndex, setEditingTimeIndex] = useState<number | null>(null);

  // Get today's medications based on reminders and taken logs
  const getTodaysMedications = (): Medication[] => {
    const today = normalizeDate(new Date());
    const todayDayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
      today.getDay()
    ];
    const todayDateKey = today.toDateString();

    const scheduledTodayIds = reminders
      .filter((r) => {
        if (!r.enabled) return false;
        if (!r.days || r.days.length === 0) {
          if (r.scheduledDate) {
            const scheduledDate = normalizeDate(new Date(r.scheduledDate));
            return scheduledDate.getTime() === today.getTime();
          }
          return false;
        }
        return r.days.includes(todayDayName);
      })
      .map((r) => r.medicationId);

    const takenTodayIds = takenLogs
      .filter((log) => log.dateKey === todayDateKey)
      .map((log) => log.medicationId)
      .filter((id) => id);

    const allTodaysMedIds = [
      ...new Set([...scheduledTodayIds, ...takenTodayIds]),
    ];

    return medications.filter(
      (m) => m.active && allTodaysMedIds.includes(m.id),
    );
  };

  // Load data
  useEffect(() => {
    const userId = auth.currentUser?.uid;
    if (!userId) return;

    const unsubscribeMeds = onSnapshot(
      query(
        collection(db, "users", userId, "medications"),
        orderBy("createdAt", "desc"),
      ),
      (snapshot) => {
        setMedications(
          snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          })) as Medication[],
        );
        setLoading(false);
        setReactionsLoaded(false);
      },
    );

    const unsubscribeReminders = onSnapshot(
      collection(db, "users", userId, "reminders"),
      (snapshot) => {
        setReminders(
          snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          })) as Reminder[],
        );
        setReactionsLoaded(false);
      },
    );

    const unsubscribeLogs = onSnapshot(
      query(
        collection(db, "users", userId, "symptom_logs"),
        orderBy("logged_at", "desc"),
      ),
      (snapshot) => {
        setSymptomLogs(
          snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          })) as SymptomLog[],
        );
      },
    );

    const unsubscribeTaken = onSnapshot(
      collection(db, "users", userId, "taken_logs"),
      (snapshot) => {
        setTakenLogs(
          snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          })) as TakenLog[],
        );
        setReactionsLoaded(false);
      },
    );

    return () => {
      unsubscribeMeds();
      unsubscribeReminders();
      unsubscribeLogs();
      unsubscribeTaken();
    };
  }, []);

  useEffect(() => {
    if (activeTab === "reactions" && !reactionsLoaded && !loadingReactions) {
      loadReactions();
    }
  }, [activeTab, reactionsLoaded]);

  // ─── One-time migration: stamp createdAt on old reminders ───────
  useEffect(() => {
    const userId = auth.currentUser?.uid;
    if (!userId || reminders.length === 0) return;

    const batch: Promise<void>[] = reminders
      .filter((r) => !r.createdAt) // only reminders missing createdAt
      .map((r) =>
        updateDoc(doc(db, "users", userId, "reminders", r.id), {
          createdAt: serverTimestamp(),
        }).catch(console.warn),
      );

    if (batch.length > 0) Promise.all(batch).catch(console.warn);
  }, [reminders]);

  const loadReactions = async () => {
    const userId = auth.currentUser?.uid;
    if (!userId) return;

    setLoadingReactions(true);
    setReactionsError(null);
    try {
      const todaysMeds = getTodaysMedications();

      if (todaysMeds.length === 0) {
        setAiAnalysis(null);
        setLoadingReactions(false);
        setReactionsLoaded(true);
        return;
      }

      const analysis = await generateReactionsAnalysis(userId, todaysMeds);
      setAiAnalysis(analysis);
    } catch (error: any) {
      console.error("Error loading reactions:", error);
      setReactionsError(error.message || "Failed to load reactions");
    } finally {
      setLoadingReactions(false);
      setReactionsLoaded(true);
    }
  };

  // Helper functions
  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(":");
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? "PM" : "AM";
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  };

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

  // Medication search
  const handleMedicineSearch = async (text: string) => {
    setMedicationForm((prev) => ({ ...prev, name: text }));
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
  };

  const handleSelectMedicine = (medicine: MedicineSearchResult) => {
    setSelectedMedicine(medicine);
    setMedicationForm((prev) => ({
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

  // Medication CRUD
  const handleSaveMedication = async () => {
    if (!medicationForm.name || !medicationForm.dosage) {
      Alert.alert("Error", "Please fill in all required fields");
      return;
    }

    const userId = auth.currentUser?.uid;
    if (!userId) return;

    if (!editingMedication && medicationForm.drug_id) {
      const existingDrugIds = medications
        .filter((m) => m.drug_id && m.active)
        .map((m) => m.drug_id);
      if (existingDrugIds.length > 0) {
        const warnings = await checkAllInteractions(
          medicationForm.drug_id,
          existingDrugIds,
        );
        if (warnings.length > 0) {
          setInteractionWarnings(warnings);
          setPendingMedication(medicationForm);
          setMedicationModalVisible(false);
          setInteractionModalVisible(true);
          return;
        }
      }
    }

    await saveMedicationToFirestore(medicationForm);
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
        Alert.alert("Success", "Medication updated");
      } else {
        const docRef = await addDoc(
          collection(db, "users", userId, "medications"),
          {
            ...data,
            active: true,
            createdAt: serverTimestamp(),
          },
        );

        Alert.alert(
          "Add Reminder",
          "Would you like to set up a reminder for this medication?",
          [
            { text: "Not Now", style: "cancel" },
            {
              text: "Add Reminder",
              onPress: () => {
                const newMed = { ...data, id: docRef.id } as Medication;
                setSelectedMedicationForReminder(newMed);
                setReminderForm({
                  medicationId: docRef.id,
                  medicationName: newMed.name,
                  medicationDosage: newMed.dosage,
                  time: ["08:00"],
                  days: [],
                  enabled: true,
                  sound: true,
                  vibrate: true,
                  durationType: "none",
                });
                setReminderModalVisible(true);
              },
            },
          ],
        );
      }
      setMedicationModalVisible(false);
      setInteractionModalVisible(false);
      setPendingMedication(null);
      setEditingMedication(null);
      resetMedicationForm();
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to save medication");
    }
  };

  const handleDeleteMedication = async (id: string) => {
    const userId = auth.currentUser?.uid;
    if (!userId) return;

    Alert.alert(
      "Delete Medication",
      "Are you sure? Associated reminders will also be deleted.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
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
          },
        },
      ],
    );
  };

  const resetMedicationForm = () => {
    setMedicationForm({
      name: "",
      dosage: "",
      quantity: 0,
      refillReminder: false,
      active: true,
      notes: "",
    });
    setSelectedMedicine(null);
    setSearchResults([]);
    setShowSuggestions(false);
  };

  // Reminder CRUD
  const handleSaveReminder = async () => {
    if (!selectedMedicationForReminder) {
      Alert.alert("Error", "Please select a medication");
      return;
    }

    const userId = auth.currentUser?.uid;
    if (!userId) return;

    const normalizedDays =
      reminderForm.days && reminderForm.days.length > 0
        ? reminderForm.days
        : [];
    const times = (reminderForm.times ?? ["08:00"]).filter(
      (t) => t.trim() !== "",
    );
    const reminderData = {
      medicationId: selectedMedicationForReminder.id,
      medicationName: selectedMedicationForReminder.name,
      medicationDosage: selectedMedicationForReminder.dosage,
      times,
      days: normalizedDays,
      enabled: reminderForm.enabled !== false,
      sound: reminderForm.sound !== false,
      vibrate: reminderForm.vibrate !== false,
      label: reminderForm.label || null,
      durationType: reminderForm.durationType || "none",
      startDate: reminderForm.startDate || null,
      endDate: reminderForm.endDate || null,
      createdAt: serverTimestamp(),
    };

    try {
      if (editingReminder) {
        await updateDoc(
          doc(db, "users", userId, "reminders", editingReminder.id),
          reminderData,
        );
        Alert.alert("Success", "Reminder updated");
      } else {
        await addDoc(
          collection(db, "users", userId, "reminders"),
          reminderData,
        );
        Alert.alert("Success", "Reminder added");
      }
      setReminderModalVisible(false);
      setSelectedMedicationForReminder(null);
      setEditingReminder(null);
      resetReminderForm();
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to save reminder");
    }
  };

  const handleDeleteReminder = async (id: string) => {
    const userId = auth.currentUser?.uid;
    if (!userId) return;

    Alert.alert("Delete Reminder", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await deleteDoc(doc(db, "users", userId, "reminders", id));
        },
      },
    ]);
  };

  const handleToggleReminder = async (id: string, enabled: boolean) => {
    const userId = auth.currentUser?.uid;
    if (!userId) return;
    await updateDoc(doc(db, "users", userId, "reminders", id), { enabled });
  };

  const resetReminderForm = () => {
    setReminderForm({
      times: ["08:00"],
      days: [],
      enabled: true,
      sound: true,
      vibrate: true,
      durationType: "none",
      startDate: "",
      endDate: "",
    });
  };

  const toggleDay = (day: string) => {
    const currentDays = reminderForm.days || [];
    setReminderForm({
      ...reminderForm,
      days: currentDays.includes(day)
        ? currentDays.filter((d) => d !== day)
        : [...currentDays, day],
    });
  };

  // Symptom log CRUD
  const handleSaveSymptomLog = async () => {
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
      Alert.alert("Success", "Symptom logged");
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to log symptom");
    }
  };

  const handleDeleteSymptomLog = async (id: string) => {
    const userId = auth.currentUser?.uid;
    if (!userId) return;

    Alert.alert("Delete Log", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
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

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const todaysMedsForDisplay = getTodaysMedications();

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Medications</Text>
        <View style={styles.headerButtons}>
          {activeTab === "reactions" && (
            <TouchableOpacity onPress={() => setLogModalVisible(true)}>
              <Ionicons name="add-circle" size={28} color={Colors.primary} />
            </TouchableOpacity>
          )}
          {activeTab !== "reactions" && (
            <>
              <TouchableOpacity onPress={() => setReminderModalVisible(true)}>
                <Ionicons name="alarm" size={24} color={Colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setEditingMedication(null);
                  resetMedicationForm();
                  setMedicationModalVisible(true);
                }}
              >
                <Ionicons name="add-circle" size={28} color={Colors.primary} />
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      {/* Search */}
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

      {/* Tabs */}
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
          {(aiAnalysis?.interactions?.length ?? 0) > 0 && (
            <View style={styles.tabBadge}>
              <Text style={styles.tabBadgeText}>
                {aiAnalysis.interactions.length}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content}>
        {activeTab === "medications" && (
          <MedicationsTab
            medications={medications}
            searchQuery={searchQuery}
            reminders={reminders}
            onAddReminder={() => setReminderModalVisible(true)}
            onEditMedication={(med) => {
              setEditingMedication(med);
              setMedicationForm(med);
              setMedicationModalVisible(true);
            }}
            onDeleteMedication={handleDeleteMedication}
          />
        )}

        {activeTab === "reminders" && (
          <RemindersTab
            reminders={reminders}
            medications={medications}
            onEditReminder={(rem) => {
              setEditingReminder(rem);
              setSelectedMedicationForReminder(
                medications.find((m) => m.id === rem.medicationId) || null,
              );
              setReminderForm(rem);
              setReminderModalVisible(true);
            }}
            onDeleteReminder={handleDeleteReminder}
            onToggleReminder={handleToggleReminder}
          />
        )}

        {activeTab === "reactions" && (
          <ReactionsTab
            aiAnalysis={aiAnalysis}
            loadingReactions={loadingReactions}
            reactionsError={reactionsError}
            symptomLogs={symptomLogs}
            medications={medications}
            todaysMedications={todaysMedsForDisplay}
            onLogSymptom={() => setLogModalVisible(true)}
            onDeleteSymptomLog={handleDeleteSymptomLog}
            onRefresh={loadReactions}
          />
        )}
      </ScrollView>

      {/* ========== ADD/EDIT MEDICATION MODAL ========== */}
      <Modal
        animationType="slide"
        transparent
        visible={medicationModalVisible}
        onRequestClose={() => {
          setMedicationModalVisible(false);
          setEditingMedication(null);
          resetMedicationForm();
        }}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingMedication ? "Edit Medication" : "Add New Medication"}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setMedicationModalVisible(false);
                  setEditingMedication(null);
                  resetMedicationForm();
                }}
              >
                <Ionicons name="close" size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled
            >
              {/* Medication Name with Search */}
              <View style={styles.formGroup}>
                <Text style={styles.label}>Medication Name *</Text>
                <TextInput
                  style={styles.input}
                  value={medicationForm.name}
                  onChangeText={handleMedicineSearch}
                  placeholder="Search brand or generic name..."
                  placeholderTextColor={Colors.textTertiary}
                  editable={!editingMedication}
                />
                {showSuggestions && !editingMedication && (
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
                      <ScrollView
                        nestedScrollEnabled
                        style={{ maxHeight: 200 }}
                      >
                        {searchResults.map((item) => (
                          <TouchableOpacity
                            key={item.id}
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
                        ))}
                      </ScrollView>
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

              {/* Dosage */}
              <View style={styles.formGroup}>
                <Text style={styles.label}>Dosage *</Text>
                <TextInput
                  style={styles.input}
                  value={medicationForm.dosage}
                  onChangeText={(text) =>
                    setMedicationForm({ ...medicationForm, dosage: text })
                  }
                  placeholder="e.g., 10mg"
                  placeholderTextColor={Colors.textTertiary}
                />
              </View>

              {/* Quantity */}
              <View style={styles.formGroup}>
                <Text style={styles.label}>Quantity</Text>
                <TextInput
                  style={styles.input}
                  value={medicationForm.quantity?.toString()}
                  onChangeText={(text) =>
                    setMedicationForm({
                      ...medicationForm,
                      quantity: parseInt(text) || 0,
                    })
                  }
                  placeholder="Number of pills/units"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardType="numeric"
                />
              </View>

              {/* Refill Reminder Switch */}
              <View style={styles.formGroup}>
                <View style={styles.switchContainer}>
                  <Text style={styles.label}>Refill Reminder</Text>
                  <Switch
                    value={medicationForm.refillReminder}
                    onValueChange={(value) =>
                      setMedicationForm({
                        ...medicationForm,
                        refillReminder: value,
                      })
                    }
                    trackColor={{ false: Colors.border, true: Colors.primary }}
                    thumbColor={Colors.surface}
                  />
                </View>
              </View>

              {/* Refill Threshold */}
              {medicationForm.refillReminder && (
                <View style={styles.formGroup}>
                  <Text style={styles.label}>Refill Threshold</Text>
                  <TextInput
                    style={styles.input}
                    value={medicationForm.refillThreshold?.toString()}
                    onChangeText={(text) =>
                      setMedicationForm({
                        ...medicationForm,
                        refillThreshold: parseInt(text) || 0,
                      })
                    }
                    placeholder="Remind when quantity below"
                    placeholderTextColor={Colors.textTertiary}
                    keyboardType="numeric"
                  />
                </View>
              )}

              {/* Notes */}
              <View style={styles.formGroup}>
                <Text style={styles.label}>Notes (Optional)</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={medicationForm.notes}
                  onChangeText={(text) =>
                    setMedicationForm({ ...medicationForm, notes: text })
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
                onPress={() => {
                  setMedicationModalVisible(false);
                  setEditingMedication(null);
                  resetMedicationForm();
                }}
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

      {/* ========== ADD/EDIT REMINDER MODAL ========== */}
      <Modal
        animationType="slide"
        transparent
        visible={reminderModalVisible}
        onRequestClose={() => {
          setReminderModalVisible(false);
          setSelectedMedicationForReminder(null);
          setEditingReminder(null);
          resetReminderForm();
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
                  setEditingReminder(null);
                  resetReminderForm();
                }}
              >
                <Ionicons name="close" size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>

            {!selectedMedicationForReminder ? (
              <View>
                <Text style={styles.label}>Select Medication</Text>
                <ScrollView style={{ maxHeight: 300 }}>
                  {medications
                    .filter((m) => m.active)
                    .map((med) => (
                      <TouchableOpacity
                        key={med.id}
                        style={styles.medicationSelectorItem}
                        onPress={() => {
                          setSelectedMedicationForReminder(med);
                          setReminderForm({
                            ...reminderForm,
                            medicationId: med.id,
                            medicationName: med.name,
                            medicationDosage: med.dosage,
                          });
                        }}
                      >
                        <View>
                          <Text style={styles.selectorMedName}>{med.name}</Text>
                          <Text style={styles.selectorMedDosage}>
                            {med.dosage}
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
            ) : (
              <ScrollView
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
              >
                <View style={styles.selectedMedicationInfo}>
                  <Text style={styles.selectedMedicationName}>
                    {selectedMedicationForReminder.name}{" "}
                    {selectedMedicationForReminder.dosage}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setSelectedMedicationForReminder(null)}
                  >
                    <Text style={{ color: Colors.error, fontSize: 12 }}>
                      Change
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.label}>Times</Text>

                  {(reminderForm.times ?? ["08:00"]).map((t, index) => (
                    <View
                      key={index}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        marginBottom: 8,
                        gap: 8,
                      }}
                    >
                      <TouchableOpacity
                        style={[styles.timePickerButton, { flex: 1 }]}
                        onPress={() => {
                          setEditingTimeIndex(index);
                          setShowTimePicker(true);
                        }}
                      >
                        <Ionicons
                          name="time-outline"
                          size={20}
                          color={Colors.primary}
                        />
                        <Text style={styles.timePickerButtonText}>
                          {formatTime(t)}
                        </Text>
                        <Ionicons
                          name="chevron-down"
                          size={18}
                          color={Colors.textTertiary}
                        />
                      </TouchableOpacity>

                      {(reminderForm.times ?? []).length > 1 && (
                        <TouchableOpacity
                          onPress={() => {
                            const updated = [...(reminderForm.times ?? [])];
                            updated.splice(index, 1);
                            setReminderForm({
                              ...reminderForm,
                              times: updated,
                            });
                          }}
                          style={{ padding: 8 }}
                        >
                          <Ionicons
                            name="remove-circle"
                            size={22}
                            color={Colors.error}
                          />
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}

                  {(reminderForm.times ?? []).length < 6 && (
                    <TouchableOpacity
                      style={styles.addTimeButton}
                      onPress={() => {
                        setReminderForm({
                          ...reminderForm,
                          times: [
                            ...(reminderForm.times ?? ["08:00"]),
                            "08:00",
                          ],
                        });
                      }}
                    >
                      <Ionicons
                        name="add-circle-outline"
                        size={18}
                        color={Colors.primary}
                      />
                      <Text style={styles.addTimeButtonText}>
                        Add another time
                      </Text>
                    </TouchableOpacity>
                  )}

                  {showTimePicker && (
                    <DateTimePicker
                      value={timeStringToDate(
                        (reminderForm.times ?? ["08:00"])[
                          editingTimeIndex ?? 0
                        ] ?? "08:00",
                      )}
                      mode="time"
                      is24Hour={false}
                      display="default"
                      onChange={(
                        event: DateTimePickerEvent,
                        selectedDate?: Date,
                      ) => {
                        setShowTimePicker(false);
                        if (event.type === "dismissed" || !selectedDate) return;
                        const updated = [...(reminderForm.times ?? ["08:00"])];
                        updated[editingTimeIndex ?? 0] =
                          dateToTimeString(selectedDate);
                        setReminderForm({ ...reminderForm, times: updated });
                        setEditingTimeIndex(null);
                      }}
                    />
                  )}
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.label}>Repeat</Text>
                  <View style={styles.daysContainer}>
                    {weekDays.map((day) => (
                      <TouchableOpacity
                        key={day}
                        style={[
                          styles.dayButton,
                          reminderForm.days?.includes(day) &&
                            styles.dayButtonActive,
                        ]}
                        onPress={() => toggleDay(day)}
                      >
                        <Text
                          style={[
                            styles.dayButtonText,
                            reminderForm.days?.includes(day) &&
                              styles.dayButtonTextActive,
                          ]}
                        >
                          {day}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {(!reminderForm.days || reminderForm.days.length === 0) && (
                    <Text style={styles.hintText}>
                      No days selected = One-time reminder
                    </Text>
                  )}
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.label}>Label (Optional)</Text>
                  <TextInput
                    style={styles.input}
                    value={reminderForm.label}
                    onChangeText={(text) =>
                      setReminderForm({ ...reminderForm, label: text })
                    }
                    placeholder="e.g., Morning dose"
                    placeholderTextColor={Colors.textTertiary}
                  />
                </View>

                <View style={styles.formGroup}>
                  <View style={styles.switchContainer}>
                    <Text style={styles.label}>Sound</Text>
                    <Switch
                      value={reminderForm.sound}
                      onValueChange={(value) =>
                        setReminderForm({ ...reminderForm, sound: value })
                      }
                      trackColor={{
                        false: Colors.border,
                        true: Colors.primary,
                      }}
                      thumbColor={Colors.surface}
                    />
                  </View>
                </View>

                <View style={styles.formGroup}>
                  <View style={styles.switchContainer}>
                    <Text style={styles.label}>Vibrate</Text>
                    <Switch
                      value={reminderForm.vibrate}
                      onValueChange={(value) =>
                        setReminderForm({ ...reminderForm, vibrate: value })
                      }
                      trackColor={{
                        false: Colors.border,
                        true: Colors.primary,
                      }}
                      thumbColor={Colors.surface}
                    />
                  </View>
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.label}>Duration (Optional)</Text>
                  <View style={styles.durationTypeRow}>
                    {[
                      { value: "none", label: "No limit" },
                      { value: "date-range", label: "Date range" },
                      { value: "until-empty", label: "Until empty" },
                    ].map((opt) => (
                      <TouchableOpacity
                        key={opt.value}
                        style={[
                          styles.durationTypeBtn,
                          reminderForm.durationType === opt.value &&
                            styles.durationTypeBtnActive,
                        ]}
                        onPress={() =>
                          setReminderForm({
                            ...reminderForm,
                            durationType: opt.value as any,
                          })
                        }
                      >
                        <Text
                          style={[
                            styles.durationTypeBtnText,
                            reminderForm.durationType === opt.value &&
                              styles.durationTypeBtnTextActive,
                          ]}
                        >
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </ScrollView>
            )}

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => {
                  setReminderModalVisible(false);
                  setSelectedMedicationForReminder(null);
                  setEditingReminder(null);
                  resetReminderForm();
                }}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.saveButton]}
                onPress={handleSaveReminder}
              >
                <Text style={styles.saveButtonText}>
                  {selectedMedicationForReminder ? "Save Reminder" : "Next"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ========== LOG SYMPTOM MODAL ========== */}
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
              nestedScrollEnabled
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
                onPress={handleSaveSymptomLog}
              >
                <Text style={styles.saveButtonText}>Log Symptom</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ========== INTERACTION WARNING MODAL ========== */}
      <Modal
        animationType="slide"
        transparent
        visible={interactionModalVisible}
        onRequestClose={() => setInteractionModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: Colors.warning }]}>
                ⚠️ Interaction Warning
              </Text>
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

            <ScrollView style={{ maxHeight: 300 }}>
              {interactionWarnings.map((warning, index) => (
                <View key={index} style={styles.warningCard}>
                  <View style={styles.warningHeader}>
                    <Ionicons name="warning" size={18} color={Colors.warning} />
                    <Text style={styles.warningDrugName}>
                      {warning.interacts_name}
                    </Text>
                  </View>
                  <Text style={styles.warningDescription}>
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
                onPress={() => {
                  if (pendingMedication) {
                    saveMedicationToFirestore(pendingMedication);
                  }
                }}
              >
                <Text style={styles.saveButtonText}>Add Anyway</Text>
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
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  headerTitle: { fontSize: 28, fontWeight: "bold", color: Colors.text },
  headerButtons: { flexDirection: "row", gap: 16 },
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
  searchInput: { flex: 1, marginLeft: 8, fontSize: 16, color: Colors.text },
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

  // Modal styles
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

  // Form styles
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

  // Search suggestions
  suggestionsContainer: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    marginTop: 4,
    maxHeight: 200,
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
    justifyContent: "space-between",
    gap: 6,
    marginTop: 6,
  },
  selectedMedicineText: {
    fontSize: 13,
    color: Colors.success,
    fontWeight: "500",
    flex: 1,
  },
  selectedMedicationName: {
    fontSize: 16,
    color: Colors.primary,
    fontWeight: "600",
  },

  // Reminder specific
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
  hintText: { fontSize: 11, color: Colors.textTertiary, marginTop: 4 },
  durationTypeRow: { flexDirection: "row", gap: 6 },
  durationTypeBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    backgroundColor: Colors.background,
  },
  durationTypeBtnActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  durationTypeBtnText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: "500",
  },
  durationTypeBtnTextActive: { color: Colors.surface },
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

  // Symptom log specific
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

  // Interaction warning specific
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
  addTimeButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  addTimeButtonText: {
    fontSize: 14,
    color: Colors.primary,
    fontWeight: "500",
  },
});
