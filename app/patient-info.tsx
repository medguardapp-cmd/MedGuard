// app/patient-info.tsx
import { useOnboarding } from "@/contexts/OnboardingContext";
import { useAuth } from "@/hooks/useAuth";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  SelectedPatientProvider,
  useSelectedPatient,
} from "../contexts/SelectedPatientContext";
import { useCaregiverPermissions } from "../hooks/useCaregiverPermissions";
import { db } from "../lib/firebase";
// Inner component that uses the hooks
function PatientInfoContent() {
  const router = useRouter();
  const { data } = useOnboarding();
  const { user } = useAuth();
  const { patientId: patientIdParam } = useLocalSearchParams<{
    patientId: string;
  }>();
  const { selectedPatientId, setSelectedPatientId, userType } =
    useSelectedPatient();

  useEffect(() => {
    if (patientIdParam) {
      setSelectedPatientId(patientIdParam);
    }
    return () => setSelectedPatientId(null);
  }, [patientIdParam, setSelectedPatientId]);

  // Use param directly — don't wait for context state to update

  // Get the correct user ID
  const targetUserId =
    userType === "caregiver"
      ? patientIdParam // ALWAYS use param
      : user?.uid;

  const { can, loading: permissionsLoading } = useCaregiverPermissions({
    patientId: userType === "caregiver" ? patientIdParam || "" : "",
    caregiverId: userType === "caregiver" ? user?.uid || "" : "",
  });

  // Determine if user can edit (patients always can, caregivers need permission)
  const canEdit =
    userType === "patient" ? true : (can?.manageHealth() ?? false);
  const canView =
    userType === "patient" ? true : (can?.manageHealth() ?? false);

  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showBloodTypePicker, setShowBloodTypePicker] = useState(false);

  // Blood type options
  const bloodTypes = [
    "A+",
    "A-",
    "B+",
    "B-",
    "AB+",
    "AB-",
    "O+",
    "O-",
    "Unknown",
  ];

  // Separate state for personal info (read-only display)
  const [patientProfile, setPatientProfile] = useState({
    name: "",
    dateOfBirth: "",
    gender: "",
  });

  // Form state for editable medical data
  const [formData, setFormData] = useState({
    bloodType: "",
    height: "",
    weight: "",
    drugAllergies: [] as string[],
    allergies: [] as string[],
    conditions: [] as string[],
    isPregnant: false,
    isBreastfeeding: false,
    dueDate: "",
    pregnancyNotes: "",
    smokingStatus: "",
    alcoholConsumption: "",
    exerciseFrequency: "",
    dietaryPreferences: "",
    lifestyleNotes: "",
    notes: "",
    updatedAt: null as any,
  });

  // Temporary state for adding new items
  const [newDrugAllergy, setNewDrugAllergy] = useState("");
  const [newAllergy, setNewAllergy] = useState("");
  const [newCondition, setNewCondition] = useState("");

  // Fetch patient data — from context if patient, from Firestore if caregiver
  useEffect(() => {
    const fetchPatientData = async () => {
      console.log("DEBUG:", {
        userType,
        patientIdParam,
        targetUserId,
      });
      // 🚫 STOP if caregiver but no patientId yet
      if (userType === "caregiver" && !patientIdParam) {
        return;
      }

      if (!targetUserId) return;

      // AFTER — only use onboarding context when patient is viewing their OWN data
      if (userType === "patient" && !patientIdParam) {
        setPatientProfile({
          name: data.userData.name || "",
          dateOfBirth: data.userData.dateOfBirth || "",
          gender: data.userData.gender || "",
        });
        setFormData({
          bloodType: data.medicalData.bloodType || "",
          height: data.medicalData.height || "",
          weight: data.medicalData.weight || "",
          drugAllergies: data.medicalData.drugAllergies || [],
          allergies: data.medicalData.allergies || [],
          conditions: data.medicalData.conditions || [],
          isPregnant: data.medicalData.isPregnant || false,
          isBreastfeeding: data.medicalData.isBreastfeeding || false,
          dueDate: data.medicalData.dueDate || "",
          pregnancyNotes: data.medicalData.pregnancyNotes || "",
          smokingStatus: data.medicalData.smokingStatus || "",
          alcoholConsumption: data.medicalData.alcoholConsumption || "",
          exerciseFrequency: data.medicalData.exerciseFrequency || "",
          dietaryPreferences: data.medicalData.dietaryPreferences || "",
          lifestyleNotes: data.medicalData.lifestyleNotes || "",
          notes: data.medicalData.notes || "",
          updatedAt: (data.medicalData as any).updatedAt || null,
        });
        return;
      }

      // Caregiver: fetch the patient's Firestore document directly
      try {
        const userRef = doc(db, "users", targetUserId);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
          const userData = userSnap.data();
          const md = userData.medicalData || {};
          const ud = userData.userData || {};

          setPatientProfile({
            name: ud.name || userData.name || "",
            dateOfBirth: ud.dateOfBirth || userData.dateOfBirth || "",
            gender: ud.gender || userData.gender || "",
          });

          setFormData({
            bloodType: md.bloodType || "",
            height: md.height || "",
            weight: md.weight || "",
            drugAllergies: md.drugAllergies || [],
            allergies: md.allergies || [],
            conditions: md.conditions || [],
            isPregnant: md.isPregnant || false,
            isBreastfeeding: md.isBreastfeeding || false,
            dueDate: md.dueDate || "",
            pregnancyNotes: md.pregnancyNotes || "",
            smokingStatus: md.smokingStatus || "",
            alcoholConsumption: md.alcoholConsumption || "",
            exerciseFrequency: md.exerciseFrequency || "",
            dietaryPreferences: md.dietaryPreferences || "",
            lifestyleNotes: md.lifestyleNotes || "",
            notes: md.notes || "",
            updatedAt: md.updatedAt || null,
          });
        }
      } catch (error) {
        console.error("Error fetching patient data:", error);
        Alert.alert("Error", "Failed to load patient information");
      }
    };

    fetchPatientData();
  }, [patientIdParam, userType]);

  // isFemale is derived from patientProfile, not the caregiver's own data
  const isFemale = patientProfile.gender?.toLowerCase() === "female";

  const handleSave = async () => {
    if (!targetUserId) {
      Alert.alert("Error", "User not authenticated");
      return;
    }

    if (userType === "caregiver" && !canEdit) {
      Alert.alert(
        "Permission Denied",
        "You don't have permission to edit health records.",
      );
      return;
    }

    setLoading(true);
    // Reset old data first (prevents showing caregiver info)
    setPatientProfile({ name: "", dateOfBirth: "", gender: "" });
    try {
      const userRef = doc(db, "users", targetUserId);

      await updateDoc(userRef, {
        "medicalData.bloodType": formData.bloodType,
        "medicalData.height": formData.height,
        "medicalData.weight": formData.weight,
        "medicalData.drugAllergies": formData.drugAllergies,
        "medicalData.allergies": formData.allergies,
        "medicalData.conditions": formData.conditions,
        "medicalData.isPregnant": formData.isPregnant,
        "medicalData.isBreastfeeding": formData.isBreastfeeding,
        "medicalData.dueDate": formData.dueDate,
        "medicalData.pregnancyNotes": formData.pregnancyNotes,
        "medicalData.smokingStatus": formData.smokingStatus,
        "medicalData.alcoholConsumption": formData.alcoholConsumption,
        "medicalData.exerciseFrequency": formData.exerciseFrequency,
        "medicalData.dietaryPreferences": formData.dietaryPreferences,
        "medicalData.lifestyleNotes": formData.lifestyleNotes,
        "medicalData.notes": formData.notes,
        "medicalData.updatedAt": new Date(),
      });

      Alert.alert("Success", "Medical information updated successfully");
      setIsEditing(false);
    } catch (error) {
      console.error("Error updating medical data:", error);
      Alert.alert("Error", "Failed to update medical information");
    } finally {
      setLoading(false);
    }
  };

  const addItem = (field: string, value: string, setter: any) => {
    if (value.trim()) {
      setFormData((prev) => ({
        ...prev,
        [field]: [...(prev as any)[field], value.trim()],
      }));
      setter("");
    }
  };

  const removeItem = (field: string, index: number) => {
    setFormData((prev) => ({
      ...prev,
      [field]: (prev as any)[field].filter((_: any, i: number) => i !== index),
    }));
  };

  // Show loading state while permissions are being resolved for caregivers
  if (userType === "caregiver" && permissionsLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={24} color="#0f172a" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Patient Information</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.blockedContainer}>
          <Text style={styles.blockedText}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // If caregiver doesn't have view permission, show blocked screen
  if (
    userType === "caregiver" &&
    !canView &&
    !permissionsLoading &&
    selectedPatientId
  ) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={24} color="#0f172a" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Patient Information</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.blockedContainer}>
          <View style={styles.blockedIconContainer}>
            <Ionicons name="lock-closed" size={60} color="#cbd5e1" />
          </View>
          <Text style={styles.blockedTitle}>Access Restricted</Text>
          <Text style={styles.blockedText}>
            You don&apos;t have permission to view this patient&apos;s medical
            information.
          </Text>
          <Text style={styles.blockedSubtext}>
            Please contact the patient or request access from your caregiver
            settings.
          </Text>
          <TouchableOpacity
            style={styles.blockedButton}
            onPress={() => router.back()}
          >
            <Text style={styles.blockedButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => (isEditing ? setIsEditing(false) : router.back())}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color="#0f172a" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Patient Information</Text>
        {!isEditing ? (
          canEdit && (
            <TouchableOpacity
              onPress={() => setIsEditing(true)}
              style={styles.editButton}
            >
              <Ionicons name="create-outline" size={22} color="#3b82f6" />
            </TouchableOpacity>
          )
        ) : (
          <TouchableOpacity
            onPress={handleSave}
            style={styles.saveButton}
            disabled={loading}
          >
            <Text style={styles.saveButtonText}>
              {loading ? "Saving..." : "Save"}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* If caregiver has view but not edit permission, show overlay on edit mode */}
      {userType === "caregiver" && !canEdit && isEditing ? (
        <View style={styles.editOverlay}>
          <View style={styles.editOverlayContent}>
            <Ionicons name="lock-closed" size={48} color="#cbd5e1" />
            <Text style={styles.editOverlayTitle}>Edit Restricted</Text>
            <Text style={styles.editOverlayText}>
              You don&apos;t have permission to edit this patient&apos;s medical
              information.
            </Text>
            <TouchableOpacity
              style={styles.editOverlayButton}
              onPress={() => setIsEditing(false)}
            >
              <Text style={styles.editOverlayButtonText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Personal Information Section - Read Only */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="person-outline" size={22} color="#3b82f6" />
            <Text style={styles.sectionTitle}>Personal Information</Text>
          </View>

          <View style={styles.infoCard}>
            <InfoRow
              label="Full Name"
              value={patientProfile.name || "Not provided"}
            />
            <Divider />
            <InfoRow
              label="Date of Birth"
              value={patientProfile.dateOfBirth || "Not provided"}
            />
            <Divider />
            <InfoRow
              label="Age"
              value={calculateAge(patientProfile.dateOfBirth)}
            />
            <Divider />
            <InfoRow
              label="Gender"
              value={
                patientProfile.gender
                  ? patientProfile.gender.charAt(0).toUpperCase() +
                    patientProfile.gender.slice(1)
                  : "Not provided"
              }
            />
          </View>
        </View>

        {/* Medical Information Section - Editable */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="medical-outline" size={22} color="#3b82f6" />
            <Text style={styles.sectionTitle}>Medical Information</Text>
          </View>

          <View style={styles.infoCard}>
            {/* Basic Vitals */}
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Blood Type</Text>
              {isEditing && canEdit ? (
                <>
                  <TouchableOpacity
                    style={styles.dropdownButton}
                    onPress={() => setShowBloodTypePicker(true)}
                  >
                    <Text style={styles.dropdownButtonText}>
                      {formData.bloodType || "Select blood type"}
                    </Text>
                    <Ionicons name="chevron-down" size={20} color="#64748b" />
                  </TouchableOpacity>

                  <Modal
                    visible={showBloodTypePicker}
                    transparent={true}
                    animationType="fade"
                    onRequestClose={() => setShowBloodTypePicker(false)}
                  >
                    <TouchableOpacity
                      style={styles.modalOverlay}
                      activeOpacity={1}
                      onPress={() => setShowBloodTypePicker(false)}
                    >
                      <View style={styles.modalContent}>
                        <View style={styles.modalHeader}>
                          <Text style={styles.modalTitle}>
                            Select Blood Type
                          </Text>
                          <TouchableOpacity
                            onPress={() => setShowBloodTypePicker(false)}
                          >
                            <Ionicons name="close" size={24} color="#64748b" />
                          </TouchableOpacity>
                        </View>
                        {bloodTypes.map((type) => (
                          <TouchableOpacity
                            key={type}
                            style={[
                              styles.bloodTypeOption,
                              formData.bloodType === type &&
                                styles.bloodTypeOptionActive,
                            ]}
                            onPress={() => {
                              setFormData((prev) => ({
                                ...prev,
                                bloodType: type,
                              }));
                              setShowBloodTypePicker(false);
                            }}
                          >
                            <Text
                              style={[
                                styles.bloodTypeOptionText,
                                formData.bloodType === type &&
                                  styles.bloodTypeOptionTextActive,
                              ]}
                            >
                              {type}
                            </Text>
                            {formData.bloodType === type && (
                              <Ionicons
                                name="checkmark"
                                size={20}
                                color="#3b82f6"
                              />
                            )}
                          </TouchableOpacity>
                        ))}
                      </View>
                    </TouchableOpacity>
                  </Modal>
                </>
              ) : (
                <Text style={styles.infoValue}>
                  {formData.bloodType || "Not specified"}
                </Text>
              )}
            </View>

            <Divider />

            <EditableInfoRow
              label="Height (cm)"
              value={formData.height}
              isEditing={isEditing && canEdit}
              onChangeText={(text: string) =>
                setFormData((prev) => ({ ...prev, height: text }))
              }
              placeholder="e.g., 165"
              keyboardType="numeric"
            />
            <Divider />
            <EditableInfoRow
              label="Weight (kg)"
              value={formData.weight}
              isEditing={isEditing && canEdit}
              onChangeText={(text: string) =>
                setFormData((prev) => ({ ...prev, weight: text }))
              }
              placeholder="e.g., 65"
              keyboardType="numeric"
            />

            {/* BMI Calculation */}
            {formData.height && formData.weight && (
              <>
                <Divider />
                <InfoRow
                  label="BMI"
                  value={calculateBMI(formData.height, formData.weight)}
                />
              </>
            )}

            {/* Drug Allergies */}
            <Divider />
            <EditableListField
              label="Drug Allergies ⚠️"
              items={formData.drugAllergies}
              isEditing={isEditing && canEdit}
              onAdd={() =>
                addItem("drugAllergies", newDrugAllergy, setNewDrugAllergy)
              }
              onRemove={(index: number) => removeItem("drugAllergies", index)}
              newItemValue={newDrugAllergy}
              onNewItemChange={setNewDrugAllergy}
              placeholder="Add drug allergy"
              emptyText="No known drug allergies"
              iconColor="#ef4444"
            />

            {/* Other Allergies */}
            <Divider />
            <EditableListField
              label="Other Allergies"
              items={formData.allergies}
              isEditing={isEditing && canEdit}
              onAdd={() => addItem("allergies", newAllergy, setNewAllergy)}
              onRemove={(index: number) => removeItem("allergies", index)}
              newItemValue={newAllergy}
              onNewItemChange={setNewAllergy}
              placeholder="Add allergy (e.g., pollen, dust)"
              emptyText="No other allergies reported"
              iconColor="#f59e0b"
            />

            {/* Medical Conditions */}
            <Divider />
            <EditableListField
              label="Medical Conditions"
              items={formData.conditions}
              isEditing={isEditing && canEdit}
              onAdd={() => addItem("conditions", newCondition, setNewCondition)}
              onRemove={(index: number) => removeItem("conditions", index)}
              newItemValue={newCondition}
              onNewItemChange={setNewCondition}
              placeholder="Add condition (e.g., diabetes, asthma)"
              emptyText="No chronic conditions reported"
              iconColor="#3b82f6"
            />

            {/* Pregnancy/Breastfeeding Status (for female patients only) */}
            {isFemale && (
              <>
                <Divider />
                <View style={styles.pregnancySection}>
                  <View style={styles.pregnancyHeader}>
                    <Ionicons name="heart-outline" size={18} color="#ec489a" />
                    <Text style={styles.pregnancyTitle}>
                      Pregnancy & Breastfeeding
                    </Text>
                  </View>

                  <EditableToggleRow
                    label="Pregnant"
                    value={formData.isPregnant}
                    isEditing={isEditing && canEdit}
                    onToggle={(value: boolean) =>
                      setFormData((prev) => ({ ...prev, isPregnant: value }))
                    }
                  />

                  {formData.isPregnant && (
                    <>
                      <Divider />
                      <EditableInfoRow
                        label="Due Date"
                        value={formData.dueDate}
                        isEditing={isEditing && canEdit}
                        onChangeText={(text: string) =>
                          setFormData((prev) => ({ ...prev, dueDate: text }))
                        }
                        placeholder="YYYY-MM-DD"
                      />
                      {formData.dueDate && (
                        <InfoRow
                          label="Trimester"
                          value={calculateTrimester(formData.dueDate)}
                        />
                      )}
                    </>
                  )}

                  <Divider />
                  <EditableToggleRow
                    label="Breastfeeding"
                    value={formData.isBreastfeeding}
                    isEditing={isEditing && canEdit}
                    onToggle={(value: boolean) =>
                      setFormData((prev) => ({
                        ...prev,
                        isBreastfeeding: value,
                      }))
                    }
                  />

                  {formData.isPregnant && (
                    <>
                      <Divider />
                      <EditableInfoRow
                        label="Pregnancy Notes"
                        value={formData.pregnancyNotes}
                        isEditing={isEditing && canEdit}
                        onChangeText={(text: string) =>
                          setFormData((prev) => ({
                            ...prev,
                            pregnancyNotes: text,
                          }))
                        }
                        placeholder="Additional pregnancy notes"
                        multiline
                      />
                    </>
                  )}
                </View>
              </>
            )}

            {/* Lifestyle Section */}
            <Divider />
            <View style={styles.lifestyleSection}>
              <View style={styles.lifestyleHeader}>
                <Ionicons name="leaf-outline" size={18} color="#10b981" />
                <Text style={styles.lifestyleTitle}>Lifestyle</Text>
              </View>

              <EditablePickerRow
                label="Smoking Status"
                value={formData.smokingStatus}
                isEditing={isEditing && canEdit}
                onSelect={(value: string) =>
                  setFormData((prev) => ({ ...prev, smokingStatus: value }))
                }
                options={[
                  "Never smoked",
                  "Former smoker",
                  "Current smoker",
                  "Not specified",
                ]}
              />
              <Divider />
              <EditablePickerRow
                label="Alcohol Consumption"
                value={formData.alcoholConsumption}
                isEditing={isEditing && canEdit}
                onSelect={(value: string) =>
                  setFormData((prev) => ({
                    ...prev,
                    alcoholConsumption: value,
                  }))
                }
                options={[
                  "Never",
                  "Occasionally",
                  "Moderately",
                  "Regularly",
                  "Not specified",
                ]}
              />
              <Divider />
              <EditablePickerRow
                label="Exercise Frequency"
                value={formData.exerciseFrequency}
                isEditing={isEditing && canEdit}
                onSelect={(value: string) =>
                  setFormData((prev) => ({ ...prev, exerciseFrequency: value }))
                }
                options={[
                  "Sedentary",
                  "1-2 times/week",
                  "3-4 times/week",
                  "5+ times/week",
                  "Not specified",
                ]}
              />
              <Divider />
              <EditableInfoRow
                label="Dietary Preferences"
                value={formData.dietaryPreferences}
                isEditing={isEditing && canEdit}
                onChangeText={(text: string) =>
                  setFormData((prev) => ({ ...prev, dietaryPreferences: text }))
                }
                placeholder="e.g., Vegetarian, Vegan, Low-sodium"
                multiline
              />
              <Divider />
              <EditableInfoRow
                label="Lifestyle Notes"
                value={formData.lifestyleNotes}
                isEditing={isEditing && canEdit}
                onChangeText={(text: string) =>
                  setFormData((prev) => ({ ...prev, lifestyleNotes: text }))
                }
                placeholder="Additional lifestyle information"
                multiline
              />
            </View>

            {/* Additional Medical Notes */}
            <Divider />
            <EditableInfoRow
              label="Additional Medical Notes"
              value={formData.notes}
              isEditing={isEditing && canEdit}
              onChangeText={(text: string) =>
                setFormData((prev) => ({ ...prev, notes: text }))
              }
              placeholder="Any other medical information"
              multiline
            />

            {/* Last Updated */}
            {formData.updatedAt && (
              <>
                <Divider />
                <InfoRow
                  label="Last Medical Update"
                  value={formatTimestamp(formData.updatedAt)}
                />
              </>
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// Main export - wraps content with provider
export default function PatientInfoScreen() {
  return (
    <SelectedPatientProvider>
      <PatientInfoContent />
    </SelectedPatientProvider>
  );
}

// Helper Functions
const calculateAge = (dateOfBirth: string): string => {
  if (!dateOfBirth) return "Not provided";
  const today = new Date();
  const birthDate = new Date(dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getDate() < birthDate.getDate())
  ) {
    age--;
  }
  return `${age} years`;
};

const calculateBMI = (heightCm: string, weightKg: string): string => {
  const height = parseFloat(heightCm) / 100;
  const weight = parseFloat(weightKg);
  if (isNaN(height) || isNaN(weight) || height === 0) return "Not calculable";
  const bmi = weight / (height * height);
  let category = "";
  if (bmi < 18.5) category = "Underweight";
  else if (bmi < 25) category = "Normal";
  else if (bmi < 30) category = "Overweight";
  else category = "Obese";
  return `${bmi.toFixed(1)} (${category})`;
};

const calculateTrimester = (dueDate: string): string => {
  if (!dueDate) return "Not specified";
  const today = new Date();
  const due = new Date(dueDate);
  const conceptionDate = new Date(due);
  conceptionDate.setDate(due.getDate() - 280);
  const weeksPregnant = Math.floor(
    (today.getTime() - conceptionDate.getTime()) / (1000 * 60 * 60 * 24 * 7),
  );
  if (weeksPregnant < 13) return "First Trimester (Weeks 1-12)";
  if (weeksPregnant < 27) return "Second Trimester (Weeks 13-26)";
  return "Third Trimester (Weeks 27-40)";
};

const formatTimestamp = (timestamp: any): string => {
  if (!timestamp) return "Not available";
  if (timestamp.toDate) {
    return timestamp.toDate().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return new Date(timestamp).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

// Helper Components
const InfoRow = ({ label, value, isMultiline = false }: any) => (
  <View style={styles.infoRow}>
    <Text style={styles.infoLabel}>{label}</Text>
    <Text style={[styles.infoValue, isMultiline && styles.infoValueMultiline]}>
      {value}
    </Text>
  </View>
);

const EditableInfoRow = ({
  label,
  value,
  isEditing,
  onChangeText,
  placeholder,
  keyboardType = "default",
  multiline = false,
}: any) => (
  <View style={styles.infoRow}>
    <Text style={styles.infoLabel}>{label}</Text>
    {isEditing ? (
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline]}
        value={value}
        onChangeText={(text) => {
          if (keyboardType === "numeric") {
            const numericText = text.replace(/[^0-9.]/g, "");
            const parts = numericText.split(".");
            const formattedText =
              parts.length > 2
                ? parts[0] + "." + parts.slice(1).join("")
                : numericText;
            onChangeText(formattedText);
          } else {
            onChangeText(text);
          }
        }}
        placeholder={placeholder}
        keyboardType={keyboardType}
        multiline={multiline}
        numberOfLines={multiline ? 3 : 1}
      />
    ) : (
      <Text style={styles.infoValue}>{value || "Not provided"}</Text>
    )}
  </View>
);

const EditableToggleRow = ({ label, value, isEditing, onToggle }: any) => (
  <View style={styles.infoRow}>
    <Text style={styles.infoLabel}>{label}</Text>
    {isEditing ? (
      <View style={styles.toggleContainer}>
        <TouchableOpacity
          style={[
            styles.toggleOption,
            value === true && styles.toggleOptionActive,
          ]}
          onPress={() => onToggle(true)}
        >
          <Text
            style={[
              styles.toggleText,
              value === true && styles.toggleTextActive,
            ]}
          >
            Yes
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.toggleOption,
            value === false && styles.toggleOptionActive,
          ]}
          onPress={() => onToggle(false)}
        >
          <Text
            style={[
              styles.toggleText,
              value === false && styles.toggleTextActive,
            ]}
          >
            No
          </Text>
        </TouchableOpacity>
      </View>
    ) : (
      <Text style={styles.infoValue}>{value ? "Yes" : "No"}</Text>
    )}
  </View>
);

const EditablePickerRow = ({
  label,
  value,
  isEditing,
  onSelect,
  options,
}: any) => (
  <View style={styles.infoRow}>
    <Text style={styles.infoLabel}>{label}</Text>
    {isEditing ? (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.pickerScrollView}
      >
        <View style={styles.pickerContainer}>
          {options.map((option: string) => (
            <TouchableOpacity
              key={option}
              style={[
                styles.pickerOption,
                value === option && styles.pickerOptionActive,
              ]}
              onPress={() => onSelect(option)}
            >
              <Text
                style={[
                  styles.pickerOptionText,
                  value === option && styles.pickerOptionTextActive,
                ]}
              >
                {option}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    ) : (
      <Text style={styles.infoValue}>{value || "Not specified"}</Text>
    )}
  </View>
);

const EditableListField = ({
  label,
  items,
  isEditing,
  onAdd,
  onRemove,
  newItemValue,
  onNewItemChange,
  placeholder,
  emptyText,
  iconColor = "#3b82f6",
}: any) => (
  <View style={styles.infoRow}>
    <Text style={styles.infoLabel}>{label}</Text>
    <View style={styles.listContainer}>
      {items.length > 0 ? (
        items.map((item: string, index: number) => (
          <View key={index} style={styles.listItem}>
            <Ionicons name="medkit-outline" size={14} color={iconColor} />
            <Text style={[styles.listItemText, { color: iconColor }]}>
              {item}
            </Text>
            {isEditing && (
              <TouchableOpacity
                onPress={() => onRemove(index)}
                style={styles.removeButton}
              >
                <Ionicons name="close-circle" size={18} color="#ef4444" />
              </TouchableOpacity>
            )}
          </View>
        ))
      ) : (
        <Text style={styles.emptyText}>{emptyText}</Text>
      )}
      {isEditing && (
        <View style={styles.addItemContainer}>
          <TextInput
            style={styles.addItemInput}
            value={newItemValue}
            onChangeText={onNewItemChange}
            placeholder={placeholder}
          />
          <TouchableOpacity
            style={styles.addButton}
            onPress={onAdd}
            disabled={!newItemValue.trim()}
          >
            <Ionicons
              name="add-circle"
              size={24}
              color={newItemValue.trim() ? "#3b82f6" : "#cbd5e1"}
            />
          </TouchableOpacity>
        </View>
      )}
    </View>
  </View>
);

const Divider = () => <View style={styles.divider} />;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8fafc",
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
    fontSize: 15,
    fontWeight: "600",
    color: "#0f172a",
  },
  editButton: {
    padding: 4,
  },
  saveButton: {
    backgroundColor: "#3b82f6",
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 8,
  },
  saveButtonText: {
    color: "white",
    fontWeight: "600",
    fontSize: 13,
  },
  section: {
    marginTop: 20,
    paddingHorizontal: 16,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0f172a",
  },
  infoCard: {
    backgroundColor: "white",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    overflow: "hidden",
  },
  infoRow: {
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  infoLabel: {
    fontSize: 12,
    fontWeight: "500",
    color: "#64748b",
    marginBottom: 6,
  },
  infoValue: {
    fontSize: 14,
    color: "#0f172a",
    fontWeight: "500",
  },
  infoValueMultiline: {
    lineHeight: 22,
    marginTop: 4,
  },
  input: {
    fontSize: 14,
    color: "#0f172a",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    padding: 10,
    backgroundColor: "#f8fafc",
  },
  inputMultiline: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  divider: {
    height: 1,
    backgroundColor: "#f1f5f9",
  },
  dropdownButton: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    padding: 10,
    backgroundColor: "#f8fafc",
  },
  dropdownButtonText: {
    fontSize: 14,
    color: "#0f172a",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    backgroundColor: "white",
    borderRadius: 12,
    width: "80%",
    maxHeight: "70%",
    padding: 20,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#0f172a",
  },
  bloodTypeOption: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  bloodTypeOptionActive: {
    backgroundColor: "#eff6ff",
  },
  bloodTypeOptionText: {
    fontSize: 16,
    color: "#0f172a",
  },
  bloodTypeOptionTextActive: {
    color: "#3b82f6",
    fontWeight: "600",
  },
  listContainer: {
    marginTop: 4,
  },
  listItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  listItemText: {
    fontSize: 15,
    flex: 1,
    lineHeight: 22,
  },
  emptyText: {
    fontSize: 14,
    color: "#94a3b8",
    fontStyle: "italic",
  },
  removeButton: {
    padding: 2,
  },
  addItemContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    gap: 8,
  },
  addItemInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    padding: 8,
    fontSize: 14,
    backgroundColor: "#f8fafc",
  },
  addButton: {
    padding: 4,
  },
  toggleContainer: {
    flexDirection: "row",
    gap: 12,
  },
  toggleOption: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "white",
  },
  toggleOptionActive: {
    backgroundColor: "#3b82f6",
    borderColor: "#3b82f6",
  },
  toggleText: {
    color: "#64748b",
    fontWeight: "500",
  },
  toggleTextActive: {
    color: "white",
  },
  pickerScrollView: {
    flexGrow: 0,
  },
  pickerContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  pickerOption: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "white",
  },
  pickerOptionActive: {
    backgroundColor: "#3b82f6",
    borderColor: "#3b82f6",
  },
  pickerOptionText: {
    fontSize: 13,
    color: "#64748b",
  },
  pickerOptionTextActive: {
    color: "white",
  },
  pregnancySection: {
    backgroundColor: "#fdf2f8",
    margin: -1,
  },
  pregnancyHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  pregnancyTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#ec489a",
  },
  lifestyleSection: {
    backgroundColor: "#f0fdf4",
    margin: -1,
  },
  lifestyleHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  lifestyleTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#10b981",
  },
  blockedContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  blockedIconContainer: {
    marginBottom: 16,
  },
  blockedTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a",
    marginBottom: 8,
  },
  blockedText: {
    fontSize: 14,
    color: "#64748b",
    textAlign: "center",
    marginBottom: 8,
  },
  blockedSubtext: {
    fontSize: 13,
    color: "#94a3b8",
    textAlign: "center",
    marginBottom: 24,
  },
  blockedButton: {
    backgroundColor: "#3b82f6",
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  blockedButtonText: {
    color: "white",
    fontWeight: "600",
    fontSize: 14,
  },
  editOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255,255,255,0.95)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10,
  },
  editOverlayContent: {
    alignItems: "center",
    padding: 32,
  },
  editOverlayTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a",
    marginTop: 12,
    marginBottom: 8,
  },
  editOverlayText: {
    fontSize: 14,
    color: "#64748b",
    textAlign: "center",
    marginBottom: 24,
  },
  editOverlayButton: {
    backgroundColor: "#3b82f6",
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  editOverlayButtonText: {
    color: "white",
    fontWeight: "600",
    fontSize: 14,
  },
});
