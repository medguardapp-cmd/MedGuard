// app/(tabs)/patient-info.tsx
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { doc, updateDoc } from "firebase/firestore";
import React, { useState } from "react";
import {
  Alert,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useOnboarding } from "../contexts/OnboardingContext";
import { useAuth } from "../hooks/useAuth";
import { db } from "../lib/firebase";
export default function PatientInfoScreen() {
  const router = useRouter();
  const { data } = useOnboarding();
  const { user } = useAuth(); // Get current user
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

  // Form state
  const [formData, setFormData] = useState({
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
  });

  // Temporary state for adding new items
  const [newDrugAllergy, setNewDrugAllergy] = useState("");
  const [newAllergy, setNewAllergy] = useState("");
  const [newCondition, setNewCondition] = useState("");

  // Check if user is female to show pregnancy info
  const isFemale = data.userData.gender?.toLowerCase() === "female";

  const handleSave = async () => {
    if (!user) {
      Alert.alert("Error", "User not authenticated");
      return;
    }

    setLoading(true);
    try {
      // Directly update Firestore
      const userRef = doc(db, "users", user.uid);

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

      // Optional: Refresh the data in your context
      // You might want to add a refresh function to your OnboardingContext
      // or just reload the data
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
        [field]: [...prev[field], value.trim()],
      }));
      setter("");
    }
  };

  const removeItem = (field: string, index: number) => {
    setFormData((prev) => ({
      ...prev,
      [field]: prev[field].filter((_: any, i: number) => i !== index),
    }));
  };

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
          <TouchableOpacity
            onPress={() => setIsEditing(true)}
            style={styles.editButton}
          >
            <Ionicons name="create-outline" size={22} color="#3b82f6" />
          </TouchableOpacity>
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
              value={data.userData.name || "Not provided"}
            />
            <Divider />
            <InfoRow
              label="Date of Birth"
              value={data.userData.dateOfBirth || "Not provided"}
            />
            <Divider />
            <InfoRow
              label="Age"
              value={calculateAge(data.userData.dateOfBirth)}
            />
            <Divider />
            <InfoRow
              label="Gender"
              value={
                data.userData.gender
                  ? data.userData.gender.charAt(0).toUpperCase() +
                    data.userData.gender.slice(1)
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
              {isEditing ? (
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
              isEditing={isEditing}
              onChangeText={(text) =>
                setFormData((prev) => ({ ...prev, height: text }))
              }
              placeholder="e.g., 165"
              keyboardType="numeric"
            />
            <Divider />
            <EditableInfoRow
              label="Weight (kg)"
              value={formData.weight}
              isEditing={isEditing}
              onChangeText={(text) =>
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
              isEditing={isEditing}
              onAdd={() =>
                addItem("drugAllergies", newDrugAllergy, setNewDrugAllergy)
              }
              onRemove={(index) => removeItem("drugAllergies", index)}
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
              isEditing={isEditing}
              onAdd={() => addItem("allergies", newAllergy, setNewAllergy)}
              onRemove={(index) => removeItem("allergies", index)}
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
              isEditing={isEditing}
              onAdd={() => addItem("conditions", newCondition, setNewCondition)}
              onRemove={(index) => removeItem("conditions", index)}
              newItemValue={newCondition}
              onNewItemChange={setNewCondition}
              placeholder="Add condition (e.g., diabetes, asthma)"
              emptyText="No chronic conditions reported"
              iconColor="#3b82f6"
            />

            {/* Pregnancy/Breastfeeding Status (for female users only) */}
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
                    isEditing={isEditing}
                    onToggle={(value) =>
                      setFormData((prev) => ({ ...prev, isPregnant: value }))
                    }
                  />

                  {formData.isPregnant && (
                    <>
                      <Divider />
                      <EditableInfoRow
                        label="Due Date"
                        value={formData.dueDate}
                        isEditing={isEditing}
                        onChangeText={(text) =>
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
                    isEditing={isEditing}
                    onToggle={(value) =>
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
                        isEditing={isEditing}
                        onChangeText={(text) =>
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
                isEditing={isEditing}
                onSelect={(value) =>
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
                isEditing={isEditing}
                onSelect={(value) =>
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
                isEditing={isEditing}
                onSelect={(value) =>
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
                isEditing={isEditing}
                onChangeText={(text) =>
                  setFormData((prev) => ({ ...prev, dietaryPreferences: text }))
                }
                placeholder="e.g., Vegetarian, Vegan, Low-sodium"
                multiline
              />

              <Divider />
              <EditableInfoRow
                label="Lifestyle Notes"
                value={formData.lifestyleNotes}
                isEditing={isEditing}
                onChangeText={(text) =>
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
              isEditing={isEditing}
              onChangeText={(text) =>
                setFormData((prev) => ({ ...prev, notes: text }))
              }
              placeholder="Any other medical information"
              multiline
            />

            {/* Last Updated */}
            {(data.medicalData.updatedAt || data.userData.updatedAt) && (
              <>
                <Divider />
                <InfoRow
                  label="Last Medical Update"
                  value={formatTimestamp(
                    data.medicalData.updatedAt || data.userData.updatedAt,
                  )}
                />
              </>
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// Helper Functions (keep all the same helper functions from your original code)
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

// Helper Components (keep all the same helper components from your original code)
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
          // Add validation for numeric fields
          if (keyboardType === "numeric") {
            // Only allow numbers and decimal point
            const numericText = text.replace(/[^0-9.]/g, "");
            // Prevent multiple decimal points
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
    paddingBottom: 50,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingTop: 50,
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
});
