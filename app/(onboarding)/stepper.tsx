// app/(onboarding)/stepper.tsx - WITH CONDITIONAL STEPS FOR CAREGIVERS

import Colors from "@/constants/colors";
import { useRouter } from "expo-router";
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
import { useOnboarding } from "../../contexts/OnboardingContext";

// Add this right after imports, before export default function
const GENDERS = [
  { id: "male", label: "Male" },
  { id: "female", label: "Female" },
  { id: "other", label: "Other" },
  { id: "prefer-not-to-say", label: "Prefer not to say" },
];

export default function OnboardingStepper() {
  const router = useRouter();
  const {
    data,
    currentStep,
    setCurrentStep,
    updateUserData,
    updateMedicalData,
    completeOnboarding,
    isLoading,
    saveCurrentData,
  } = useOnboarding();

  const [newCondition, setNewCondition] = useState("");
  const [newAllergy, setNewAllergy] = useState("");
  const [newMedication, setNewMedication] = useState("");

  const [newConditionMedical, setNewConditionMedical] = useState("");
  const [newAllergyMedical, setNewAllergyMedical] = useState("");
  const [newDrugAllergyMedical, setNewDrugAllergyMedical] = useState("");

  const [customGender, setCustomGender] = useState(
    data.userData.gender && !GENDERS.find((g) => g.id === data.userData.gender)
      ? data.userData.gender
      : "",
  );

  const [showCustomGender, setShowCustomGender] = useState(
    data.userData.gender === "other" ||
      (data.userData.gender &&
        !GENDERS.find((g) => g.id === data.userData.gender)),
  );

  // Generate years (1900 to current year)
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: currentYear - 1900 + 1 }, (_, i) =>
    (currentYear - i).toString(),
  );

  // Months
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  // Days (1-31)
  const days = Array.from({ length: 31 }, (_, i) => (i + 1).toString());
  // Add these with the other useState declarations
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [showDayPicker, setShowDayPicker] = useState(false);
  const [showYearPicker, setShowYearPicker] = useState(false);
  // Parse existing date if available
  const parseDate = () => {
    if (data.userData.dateOfBirth && data.userData.dateOfBirth.includes("-")) {
      const [year, month, day] = data.userData.dateOfBirth.split("-");
      return {
        year: year || "",
        month: month ? parseInt(month) - 1 : -1,
        day: day ? parseInt(day) : -1,
      };
    }
    return { year: "", month: -1, day: -1 };
  };

  const {
    year: selectedYear,
    month: selectedMonth,
    day: selectedDay,
  } = parseDate();

  // ✅ Calculate total steps based on user type
  const getTotalSteps = () => {
    if (data.userData.userType === "caregiver") {
      return 3; // User Type, Personal Info, Connect (no medical info)
    }
    return 4; // User Type, Personal Info, Medical Info, Connect
  };

  const TOTAL_STEPS = getTotalSteps();

  // Helper to split name into first and last name
  const getFirstName = () => {
    return data.userData.name.split(" ")[0] || "";
  };

  const getLastName = () => {
    const parts = data.userData.name.split(" ");
    return parts.length > 1 ? parts.slice(1).join(" ") : "";
  };

  const handleNameChange = (type: "first" | "last", value: string) => {
    const firstName = type === "first" ? value : getFirstName();
    const lastName = type === "last" ? value : getLastName();

    const fullName = `${firstName} ${lastName}`.trim();
    updateUserData({ name: fullName });
  };

  const handleDateChange = (year: string, month: number, day: number) => {
    if (year && month !== -1 && day !== -1) {
      const monthNum = (month + 1).toString().padStart(2, "0");
      const dayNum = day.toString().padStart(2, "0");
      updateUserData({ dateOfBirth: `${year}-${monthNum}-${dayNum}` });
    }
  };

  const handleGenderSelect = (genderId: string) => {
    if (genderId === "other") {
      setShowCustomGender(true);
      updateUserData({ gender: "other" });
      setCustomGender("");
    } else {
      setShowCustomGender(false);
      updateUserData({ gender: genderId });
      setCustomGender("");
    }
  };

  const handleCustomGenderChange = (text: string) => {
    setCustomGender(text);
    updateUserData({ gender: text });
  };

  // Auto-capitalize first letter of each word
  const capitalizeName = (text: string) => {
    return text.replace(/\b\w/g, (char) => char.toUpperCase());
  };

  const handleFirstNameChange = (text: string) => {
    const capitalized = capitalizeName(text);
    handleNameChange("first", capitalized);
  };

  const handleLastNameChange = (text: string) => {
    const capitalized = capitalizeName(text);
    handleNameChange("last", capitalized);
  };

  const handleComplete = async () => {
    try {
      await completeOnboarding();
      router.replace("/(tabs)");
    } catch (error) {
      console.error("Error completing onboarding:", error);
      Alert.alert(
        "Error",
        "Failed to save your information. Please try again.",
      );
    }
  };

  const handleNext = async () => {
    // Validate current step
    if (currentStep === 0 && !data.userData.userType) {
      Alert.alert("Error", "Please select a user type");
      return;
    }

    if (currentStep === 1) {
      if (!getFirstName().trim()) {
        Alert.alert("Error", "Please enter your first name");
        return;
      }
      if (!getLastName().trim()) {
        Alert.alert("Error", "Please enter your last name");
        return;
      }
      if (!data.userData.dateOfBirth) {
        Alert.alert("Error", "Please enter your date of birth");
        return;
      }
      if (data.userData.dateOfBirth.length !== 10) {
        Alert.alert("Error", "Please enter a complete date (YYYY-MM-DD)");
        return;
      }
      if (!data.userData.gender) {
        Alert.alert("Error", "Please select your gender");
        return;
      }
    }

    // Save current step data to Firestore before proceeding
    if (currentStep >= 1) {
      try {
        await saveCurrentData();
      } catch (error) {
        Alert.alert(
          "Error",
          "Failed to save your progress. Please check your connection.",
        );
        return;
      }
    }

    if (currentStep < TOTAL_STEPS - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSkip = async () => {
    if (currentStep < TOTAL_STEPS - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  // Step 1: User Type (same for both)
  const renderStep1 = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>How will you use MedGuard?</Text>
      <Text style={styles.stepDescription}>
        Select your role to customize your experience
      </Text>

      <View style={styles.optionsContainer}>
        <TouchableOpacity
          style={[
            styles.optionCard,
            data.userData.userType === "patient" && styles.selectedCard,
          ]}
          onPress={() => {
            updateUserData({ userType: "patient" });
            // Reset to step 0 to avoid step mismatch
            if (currentStep > 0) setCurrentStep(0);
          }}
        >
          <View style={styles.optionHeader}>
            <Text style={styles.optionIcon}>👤</Text>
            <Text style={styles.optionTitle}>Patient</Text>
          </View>
          <Text style={styles.optionDescription}>
            I'm managing my own health
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.optionCard,
            data.userData.userType === "caregiver" && styles.selectedCard,
          ]}
          onPress={() => {
            updateUserData({ userType: "caregiver" });
            // Reset to step 0 to avoid step mismatch
            if (currentStep > 0) setCurrentStep(0);
          }}
        >
          <View style={styles.optionHeader}>
            <Text style={styles.optionIcon}>🤝</Text>
            <Text style={styles.optionTitle}>Caregiver</Text>
          </View>
          <Text style={styles.optionDescription}>
            I'm helping someone manage their health
          </Text>
        </TouchableOpacity>
      </View>

      {data.userData.userType === "patient" ? (
        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>About Patient Mode:</Text>
          <Text style={styles.infoText}>
            • Track your medications and appointments{"\n"}• Monitor your health
            metrics{"\n"}• Store your medical records securely{"\n"}• Get
            medication reminders{"\n"}• Share access with trusted caregivers
          </Text>
        </View>
      ) : data.userData.userType === "caregiver" ? (
        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>About Caregiver Mode:</Text>
          <Text style={styles.infoText}>
            • Help manage medications for loved ones{"\n"}• Track adherence and
            receive alerts{"\n"}• View health records (with permission){"\n"}•
            Support multiple patients{"\n"}• Get notified of missed medications
          </Text>
        </View>
      ) : (
        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>Choose your role to continue</Text>
          <Text style={styles.infoText}>
            Select either Patient or Caregiver above to see more details about
            each role.
          </Text>
        </View>
      )}
    </View>
  );

  // Step 2: Personal Info (same for both)
  // app/(onboarding)/stepper.tsx - Updated renderStep2 without phone number

  // app/(onboarding)/stepper.tsx - Updated renderStep2 with name capitalization, birthday pickers, and custom gender

  const renderStep2 = () => {
    return (
      <ScrollView
        style={styles.stepContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.stepTitle}>Personal Information</Text>
        <Text style={styles.stepDescription}>
          This information helps personalize your experience
        </Text>

        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>First Name *</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your first name"
              value={getFirstName()}
              onChangeText={handleFirstNameChange}
              autoCapitalize="words"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Last Name *</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your last name"
              value={getLastName()}
              onChangeText={handleLastNameChange}
              autoCapitalize="words"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Date of Birth *</Text>
            <View style={styles.datePickerContainer}>
              {/* Month Dropdown */}
              <View style={styles.datePickerColumn}>
                <Text style={styles.datePickerLabel}>Month</Text>
                <TouchableOpacity
                  style={styles.dropdownButton}
                  onPress={() => setShowMonthPicker(true)}
                >
                  <Text style={styles.dropdownButtonText} numberOfLines={1}>
                    {data.userData.dateOfBirth &&
                    data.userData.dateOfBirth.split("-")[1]
                      ? months[
                          parseInt(data.userData.dateOfBirth.split("-")[1]) - 1
                        ].substring(0, 3)
                      : "Month"}
                  </Text>
                  <Text style={styles.dropdownArrow}>▼</Text>
                </TouchableOpacity>
              </View>

              {/* Day Dropdown */}
              <View style={styles.datePickerColumn}>
                <Text style={styles.datePickerLabel}>Day</Text>
                <TouchableOpacity
                  style={styles.dropdownButton}
                  onPress={() => setShowDayPicker(true)}
                >
                  <Text style={styles.dropdownButtonText}>
                    {data.userData.dateOfBirth &&
                    data.userData.dateOfBirth.split("-")[2]
                      ? parseInt(data.userData.dateOfBirth.split("-")[2])
                      : "Day"}
                  </Text>
                  <Text style={styles.dropdownArrow}>▼</Text>
                </TouchableOpacity>
              </View>

              {/* Year Dropdown */}
              <View style={styles.datePickerColumn}>
                <Text style={styles.datePickerLabel}>Year</Text>
                <TouchableOpacity
                  style={styles.dropdownButton}
                  onPress={() => setShowYearPicker(true)}
                >
                  <Text style={styles.dropdownButtonText}>
                    {data.userData.dateOfBirth &&
                    data.userData.dateOfBirth.split("-")[0]
                      ? data.userData.dateOfBirth.split("-")[0]
                      : "Year"}
                  </Text>
                  <Text style={styles.dropdownArrow}>▼</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Gender *</Text>
            <View style={styles.genderOptions}>
              {GENDERS.map((gender) => (
                <TouchableOpacity
                  key={gender.id}
                  style={[
                    styles.genderOption,
                    data.userData.gender === gender.id && styles.genderSelected,
                  ]}
                  onPress={() => handleGenderSelect(gender.id)}
                >
                  <Text
                    style={[
                      styles.genderText,
                      data.userData.gender === gender.id &&
                        styles.genderTextSelected,
                    ]}
                  >
                    {gender.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Custom Gender Input */}
            {showCustomGender && (
              <TextInput
                style={[styles.input, styles.customGenderInput]}
                placeholder="Please specify your gender"
                value={customGender}
                onChangeText={handleCustomGenderChange}
                autoCapitalize="words"
              />
            )}
          </View>

          <View style={styles.noteBox}>
            <Text style={styles.noteText}>
              * Required fields. All information is stored securely in Firebase.
            </Text>
          </View>
        </View>

        {/* Modals - Move these outside the form but inside ScrollView */}
        {/* Month Picker Modal */}
        {/* Month Picker Modal */}
        {/* Month Picker Modal */}
        <Modal
          visible={showMonthPicker}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setShowMonthPicker(false)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setShowMonthPicker(false)}
          >
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Select Month</Text>
              <ScrollView>
                {months.map((month, index) => (
                  <TouchableOpacity
                    key={index}
                    style={styles.modalOption}
                    onPress={() => {
                      // Get current year and day from existing date or use defaults
                      const currentYear =
                        data.userData.dateOfBirth?.split("-")[0] || "";
                      const currentDay =
                        data.userData.dateOfBirth?.split("-")[2] || "1";
                      const monthNum = (index + 1).toString().padStart(2, "0");
                      const dayNum = currentDay.toString().padStart(2, "0");
                      updateUserData({
                        dateOfBirth: `${currentYear}-${monthNum}-${dayNum}`,
                      });
                      setShowMonthPicker(false);
                    }}
                  >
                    <Text style={styles.modalOptionText}>{month}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </TouchableOpacity>
        </Modal>

        {/* Day Picker Modal */}
        <Modal visible={showDayPicker} transparent animationType="fade">
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setShowDayPicker(false)}
          >
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Select Day</Text>
              <ScrollView>
                {days.map((day) => (
                  <TouchableOpacity
                    key={day}
                    style={styles.modalOption}
                    onPress={() => {
                      const currentYear =
                        data.userData.dateOfBirth?.split("-")[0] || "";
                      const currentMonth =
                        data.userData.dateOfBirth?.split("-")[1] || "01";
                      const dayNum = day.toString().padStart(2, "0");
                      updateUserData({
                        dateOfBirth: `${currentYear}-${currentMonth}-${dayNum}`,
                      });
                      setShowDayPicker(false);
                    }}
                  >
                    <Text style={styles.modalOptionText}>{day}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </TouchableOpacity>
        </Modal>

        {/* Year Picker Modal */}
        <Modal visible={showYearPicker} transparent animationType="fade">
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setShowYearPicker(false)}
          >
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Select Year</Text>
              <ScrollView>
                {years.map((year) => (
                  <TouchableOpacity
                    key={year}
                    style={styles.modalOption}
                    onPress={() => {
                      const currentMonth =
                        data.userData.dateOfBirth?.split("-")[1] || "01";
                      const currentDay =
                        data.userData.dateOfBirth?.split("-")[2] || "01";
                      updateUserData({
                        dateOfBirth: `${year}-${currentMonth}-${currentDay}`,
                      });
                      setShowYearPicker(false);
                    }}
                  >
                    <Text style={styles.modalOptionText}>{year}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </TouchableOpacity>
        </Modal>

        {/* Day Picker Modal */}
        <Modal visible={showDayPicker} transparent animationType="fade">
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setShowDayPicker(false)}
          >
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Select Day</Text>
              <ScrollView>
                {days.map((day) => (
                  <TouchableOpacity
                    key={day}
                    style={styles.modalOption}
                    onPress={() => {
                      handleDateChange(
                        selectedYear,
                        selectedMonth,
                        parseInt(day),
                      );
                      setShowDayPicker(false);
                    }}
                  >
                    <Text style={styles.modalOptionText}>{day}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </TouchableOpacity>
        </Modal>

        {/* Year Picker Modal */}
        <Modal visible={showYearPicker} transparent animationType="fade">
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setShowYearPicker(false)}
          >
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Select Year</Text>
              <ScrollView>
                {years.map((year) => (
                  <TouchableOpacity
                    key={year}
                    style={styles.modalOption}
                    onPress={() => {
                      handleDateChange(year, selectedMonth, selectedDay);
                      setShowYearPicker(false);
                    }}
                  >
                    <Text style={styles.modalOptionText}>{year}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </TouchableOpacity>
        </Modal>
      </ScrollView>
    );
  };

  // Step 3: Medical Info (ONLY for patients)
  // app/(onboarding)/stepper.tsx - UPDATED with complete medical info
  // Replace your renderStep3Medical function with this:

  // Step 3: Medical Info (ONLY for patients) - UPDATED with all fields
  const renderStep3Medical = () => {
    const bloodTypes = [
      "A+",
      "A-",
      "B+",
      "B-",
      "O+",
      "O-",
      "AB+",
      "AB-",
      "Unknown",
    ];

    // Check if user is female
    const isFemale = data.userData.gender?.toLowerCase() === "female";

    const addCondition = () => {
      if (
        newConditionMedical.trim() &&
        !data.medicalData.conditions.includes(newConditionMedical.trim())
      ) {
        updateMedicalData({
          conditions: [
            ...data.medicalData.conditions,
            newConditionMedical.trim(),
          ],
        });
        setNewConditionMedical("");
      }
    };

    const removeCondition = (index: number) => {
      const updated = [...data.medicalData.conditions];
      updated.splice(index, 1);
      updateMedicalData({ conditions: updated });
    };

    const addAllergy = () => {
      if (
        newAllergyMedical.trim() &&
        !data.medicalData.allergies.includes(newAllergyMedical.trim())
      ) {
        updateMedicalData({
          allergies: [...data.medicalData.allergies, newAllergyMedical.trim()],
        });
        setNewAllergyMedical("");
      }
    };

    const removeAllergy = (index: number) => {
      const updated = [...data.medicalData.allergies];
      updated.splice(index, 1);
      updateMedicalData({ allergies: updated });
    };

    const addDrugAllergy = () => {
      if (
        newDrugAllergyMedical.trim() &&
        !data.medicalData.drugAllergies?.includes(newDrugAllergyMedical.trim())
      ) {
        updateMedicalData({
          drugAllergies: [
            ...(data.medicalData.drugAllergies || []),
            newDrugAllergyMedical.trim(),
          ],
        });
        setNewDrugAllergyMedical("");
      }
    };

    const removeDrugAllergy = (index: number) => {
      const updated = [...(data.medicalData.drugAllergies || [])];
      updated.splice(index, 1);
      updateMedicalData({ drugAllergies: updated });
    };
    return (
      <ScrollView
        style={styles.stepContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.stepTitle}>Medical Information</Text>
        <Text style={styles.stepDescription}>
          Share your health information for better care
        </Text>

        <View style={styles.form}>
          {/* Basic Vitals */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Basic Vitals</Text>

            <View style={styles.row}>
              <View style={styles.halfInput}>
                <Text style={styles.label}>Blood Type</Text>
                <View style={styles.bloodTypeContainer}>
                  {bloodTypes.map((type) => (
                    <TouchableOpacity
                      key={type}
                      style={[
                        styles.bloodTypeOption,
                        data.medicalData.bloodType === type &&
                          styles.bloodTypeSelected,
                      ]}
                      onPress={() => updateMedicalData({ bloodType: type })}
                    >
                      <Text
                        style={[
                          styles.bloodTypeText,
                          data.medicalData.bloodType === type &&
                            styles.bloodTypeTextSelected,
                        ]}
                      >
                        {type}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>

            <View style={styles.row}>
              <View style={styles.halfInput}>
                <Text style={styles.label}>Height (cm)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g., 165"
                  value={data.medicalData.height}
                  onChangeText={(text) => updateMedicalData({ height: text })}
                  keyboardType="numeric"
                />
              </View>

              <View style={styles.halfInput}>
                <Text style={styles.label}>Weight (kg)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g., 65"
                  value={data.medicalData.weight}
                  onChangeText={(text) => updateMedicalData({ weight: text })}
                  keyboardType="numeric"
                />
              </View>
            </View>
          </View>

          {/* Drug Allergies (must-have for reactions feature) */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Drug Allergies ⚠️</Text>
            <Text style={styles.sectionDescription}>
              List any medication allergies (important for medication safety)
            </Text>

            <View style={styles.inputWithButton}>
              <TextInput
                style={[styles.input, styles.flexInput]}
                placeholder="e.g., Penicillin, Sulfa, Ibuprofen"
                value={newDrugAllergyMedical}
                onChangeText={setNewDrugAllergyMedical}
                onSubmitEditing={addDrugAllergy}
              />
              <TouchableOpacity
                style={styles.addButton}
                onPress={addDrugAllergy}
                disabled={!newDrugAllergyMedical.trim()}
              >
                <Text style={styles.addButtonText}>Add</Text>
              </TouchableOpacity>
            </View>

            {(data.medicalData.drugAllergies || []).length > 0 && (
              <View style={styles.listContainer}>
                {(data.medicalData.drugAllergies || []).map(
                  (allergy, index) => (
                    <View key={index} style={styles.listItem}>
                      <Text style={styles.listItemText}>⚠️ {allergy}</Text>
                      <TouchableOpacity
                        onPress={() => removeDrugAllergy(index)}
                        style={styles.removeButton}
                      >
                        <Text style={styles.removeButtonText}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  ),
                )}
              </View>
            )}
          </View>

          {/* Other Allergies */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Other Allergies</Text>
            <Text style={styles.sectionDescription}>
              List food, environmental, or other allergies
            </Text>

            <View style={styles.inputWithButton}>
              <TextInput
                style={[styles.input, styles.flexInput]}
                placeholder="e.g., Peanuts, Pollen, Latex"
                value={newAllergyMedical}
                onChangeText={setNewAllergyMedical}
                onSubmitEditing={addAllergy}
              />
              <TouchableOpacity
                style={styles.addButton}
                onPress={addAllergy}
                disabled={!newAllergy.trim()}
              >
                <Text style={styles.addButtonText}>Add</Text>
              </TouchableOpacity>
            </View>

            {data.medicalData.allergies.length > 0 && (
              <View style={styles.listContainer}>
                {data.medicalData.allergies.map((allergy, index) => (
                  <View key={index} style={styles.listItem}>
                    <Text style={styles.listItemText}>• {allergy}</Text>
                    <TouchableOpacity
                      onPress={() => removeAllergy(index)}
                      style={styles.removeButton}
                    >
                      <Text style={styles.removeButtonText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Medical Conditions */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Medical Conditions</Text>
            <Text style={styles.sectionDescription}>
              List any chronic or ongoing medical conditions
            </Text>

            <View style={styles.inputWithButton}>
              <TextInput
                style={[styles.input, styles.flexInput]}
                placeholder="e.g., Diabetes, Asthma, Hypertension"
                value={newConditionMedical}
                onChangeText={setNewConditionMedical}
                onSubmitEditing={addCondition}
              />
              <TouchableOpacity
                style={styles.addButton}
                onPress={addCondition}
                disabled={!newCondition.trim()}
              >
                <Text style={styles.addButtonText}>Add</Text>
              </TouchableOpacity>
            </View>

            {data.medicalData.conditions.length > 0 && (
              <View style={styles.listContainer}>
                {data.medicalData.conditions.map((condition, index) => (
                  <View key={index} style={styles.listItem}>
                    <Text style={styles.listItemText}>• {condition}</Text>
                    <TouchableOpacity
                      onPress={() => removeCondition(index)}
                      style={styles.removeButton}
                    >
                      <Text style={styles.removeButtonText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Pregnancy/Breastfeeding (only for females) */}
          {isFemale && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Pregnancy & Breastfeeding</Text>

              <View style={styles.row}>
                <View style={styles.halfInput}>
                  <Text style={styles.label}>Pregnant</Text>
                  <View style={styles.toggleContainer}>
                    <TouchableOpacity
                      style={[
                        styles.toggleOption,
                        data.medicalData.isPregnant === true &&
                          styles.toggleActive,
                      ]}
                      onPress={() => updateMedicalData({ isPregnant: true })}
                    >
                      <Text
                        style={[
                          styles.toggleText,
                          data.medicalData.isPregnant === true &&
                            styles.toggleTextActive,
                        ]}
                      >
                        Yes
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.toggleOption,
                        data.medicalData.isPregnant === false &&
                          styles.toggleActive,
                      ]}
                      onPress={() => updateMedicalData({ isPregnant: false })}
                    >
                      <Text
                        style={[
                          styles.toggleText,
                          data.medicalData.isPregnant === false &&
                            styles.toggleTextActive,
                        ]}
                      >
                        No
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.halfInput}>
                  <Text style={styles.label}>Breastfeeding</Text>
                  <View style={styles.toggleContainer}>
                    <TouchableOpacity
                      style={[
                        styles.toggleOption,
                        data.medicalData.isBreastfeeding === true &&
                          styles.toggleActive,
                      ]}
                      onPress={() =>
                        updateMedicalData({ isBreastfeeding: true })
                      }
                    >
                      <Text
                        style={[
                          styles.toggleText,
                          data.medicalData.isBreastfeeding === true &&
                            styles.toggleTextActive,
                        ]}
                      >
                        Yes
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.toggleOption,
                        data.medicalData.isBreastfeeding === false &&
                          styles.toggleActive,
                      ]}
                      onPress={() =>
                        updateMedicalData({ isBreastfeeding: false })
                      }
                    >
                      <Text
                        style={[
                          styles.toggleText,
                          data.medicalData.isBreastfeeding === false &&
                            styles.toggleTextActive,
                        ]}
                      >
                        No
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              {data.medicalData.isPregnant && (
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Due Date</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="YYYY-MM-DD"
                    value={data.medicalData.dueDate || ""}
                    onChangeText={(text) =>
                      updateMedicalData({ dueDate: text })
                    }
                  />
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    placeholder="Pregnancy Notes (optional)"
                    value={data.medicalData.pregnancyNotes || ""}
                    onChangeText={(text) =>
                      updateMedicalData({ pregnancyNotes: text })
                    }
                    multiline
                    numberOfLines={2}
                  />
                </View>
              )}
            </View>
          )}

          {/* Lifestyle Section - IMPROVED UI */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Lifestyle</Text>
            <Text style={styles.sectionDescription}>
              Tell us about your lifestyle habits
            </Text>

            {/* Smoking Status */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Smoking Status</Text>
              <View style={styles.optionsGrid}>
                {["Never smoked", "Former smoker", "Current smoker"].map(
                  (option) => (
                    <TouchableOpacity
                      key={option}
                      style={[
                        styles.optionChip,
                        data.medicalData.smokingStatus === option &&
                          styles.optionChipActive,
                      ]}
                      onPress={() =>
                        updateMedicalData({ smokingStatus: option })
                      }
                    >
                      <Text
                        style={[
                          styles.optionChipText,
                          data.medicalData.smokingStatus === option &&
                            styles.optionChipTextActive,
                        ]}
                      >
                        {option}
                      </Text>
                    </TouchableOpacity>
                  ),
                )}
              </View>
            </View>

            {/* Alcohol Consumption */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Alcohol Consumption</Text>
              <View style={styles.optionsGrid}>
                {["Never", "Occasionally", "Moderately", "Regularly"].map(
                  (option) => (
                    <TouchableOpacity
                      key={option}
                      style={[
                        styles.optionChip,
                        data.medicalData.alcoholConsumption === option &&
                          styles.optionChipActive,
                      ]}
                      onPress={() =>
                        updateMedicalData({ alcoholConsumption: option })
                      }
                    >
                      <Text
                        style={[
                          styles.optionChipText,
                          data.medicalData.alcoholConsumption === option &&
                            styles.optionChipTextActive,
                        ]}
                      >
                        {option}
                      </Text>
                    </TouchableOpacity>
                  ),
                )}
              </View>
            </View>

            {/* Exercise Frequency */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Exercise Frequency</Text>
              <View style={styles.optionsGrid}>
                {[
                  "Sedentary",
                  "1-2 times/week",
                  "3-4 times/week",
                  "5+ times/week",
                ].map((option) => (
                  <TouchableOpacity
                    key={option}
                    style={[
                      styles.optionChip,
                      data.medicalData.exerciseFrequency === option &&
                        styles.optionChipActive,
                    ]}
                    onPress={() =>
                      updateMedicalData({ exerciseFrequency: option })
                    }
                  >
                    <Text
                      style={[
                        styles.optionChipText,
                        data.medicalData.exerciseFrequency === option &&
                          styles.optionChipTextActive,
                      ]}
                    >
                      {option}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Dietary Preferences */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Dietary Preferences</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g., Vegetarian, Vegan, Low-sodium, Gluten-free"
                value={data.medicalData.dietaryPreferences || ""}
                onChangeText={(text) =>
                  updateMedicalData({ dietaryPreferences: text })
                }
              />
            </View>

            {/* Lifestyle Notes */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Lifestyle Notes</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Any additional lifestyle information"
                value={data.medicalData.lifestyleNotes || ""}
                onChangeText={(text) =>
                  updateMedicalData({ lifestyleNotes: text })
                }
                multiline
                numberOfLines={3}
              />
            </View>
          </View>

          {/* Additional Notes */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Additional Medical Notes</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Any other important medical information"
              value={data.medicalData.notes}
              onChangeText={(text) => updateMedicalData({ notes: text })}
              multiline
              numberOfLines={4}
            />
          </View>

          <View style={styles.privacyNote}>
            <Text style={styles.privacyText}>
              🔒 Your medical information is encrypted and stored securely in
              Firebase.
            </Text>
          </View>
        </View>
      </ScrollView>
    );
  };

  // Step 3/4: Connect (for caregivers, this is step 3; for patients, step 4)
  const renderConnectStep = () => {
    const isPatient = data.userData.userType === "patient";
    const stepNumber = isPatient ? 4 : 3;

    return (
      <ScrollView
        style={styles.stepContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.centerContent}>
          <View style={styles.caregiverIconContainer}>
            <Text style={styles.caregiverIcon}>{isPatient ? "👨‍👩‍👧‍👦" : "🎉"}</Text>
          </View>

          <Text style={styles.stepTitle}>
            {isPatient ? "Connect with Caregiver" : "You're All Set!"}
          </Text>

          <Text style={styles.stepDescription}>
            {isPatient
              ? "Optionally connect with a family member or caregiver who can help manage your health"
              : "Your account is ready! You can now connect with patients using their unique codes."}
          </Text>

          {isPatient ? (
            <>
              <View style={styles.caregiverInfoCard}>
                <Text style={styles.caregiverInfoTitle}>
                  Caregiver Benefits:
                </Text>
                <View style={styles.benefitItem}>
                  <Text style={styles.benefitIcon}>📱</Text>
                  <Text style={styles.benefitText}>
                    Medication reminders sent to both you and caregiver
                  </Text>
                </View>
                <View style={styles.benefitItem}>
                  <Text style={styles.benefitIcon}>🏥</Text>
                  <Text style={styles.benefitText}>
                    Caregiver can view your health records (with permission)
                  </Text>
                </View>
                <View style={styles.benefitItem}>
                  <Text style={styles.benefitIcon}>🔄</Text>
                  <Text style={styles.benefitText}>
                    Sync appointments and medication schedules
                  </Text>
                </View>
                <View style={styles.benefitItem}>
                  <Text style={styles.benefitIcon}>🆘</Text>
                  <Text style={styles.benefitText}>
                    Emergency alerts sent to caregiver
                  </Text>
                </View>
              </View>

              <View style={styles.skipNote}>
                <Text style={styles.skipNoteText}>
                  You can skip this step and add a caregiver later from the
                  Caregiver tab.
                </Text>
              </View>
            </>
          ) : (
            <>
              <View style={styles.caregiverInfoCard}>
                <Text style={styles.caregiverInfoTitle}>Next Steps:</Text>
                <View style={styles.benefitItem}>
                  <Text style={styles.benefitIcon}>🔑</Text>
                  <Text style={styles.benefitText}>
                    Ask patients for their 6-character connection code
                  </Text>
                </View>
                <View style={styles.benefitItem}>
                  <Text style={styles.benefitIcon}>📱</Text>
                  <Text style={styles.benefitText}>
                    Go to the Caregiver tab to connect with patients
                  </Text>
                </View>
                <View style={styles.benefitItem}>
                  <Text style={styles.benefitIcon}>👁️</Text>
                  <Text style={styles.benefitText}>
                    Access patient data based on their granted permissions
                  </Text>
                </View>
              </View>
            </>
          )}
        </View>
      </ScrollView>
    );
  };

  const renderStepContent = () => {
    const isPatient = data.userData.userType === "patient";

    switch (currentStep) {
      case 0:
        return renderStep1();
      case 1:
        return renderStep2();
      case 2:
        // For patients, show medical info; for caregivers, show connect step
        return isPatient ? renderStep3Medical() : renderConnectStep();
      case 3:
        // Only patients reach step 3 (connect step)
        return renderConnectStep();
      default:
        return null;
    }
  };

  // Dynamic step titles
  const getStepTitle = () => {
    const isPatient = data.userData.userType === "patient";

    if (currentStep === 0) return "User Type";
    if (currentStep === 1) return "Personal Info";
    if (currentStep === 2) return isPatient ? "Medical Info" : "Complete Setup";
    if (currentStep === 3) return "Connect Caregiver";
    return "";
  };

  const getStepDescription = () => {
    const isPatient = data.userData.userType === "patient";

    if (currentStep === 0) return "Select how you will use MedGuard";
    if (currentStep === 1) return "Tell us about yourself";
    if (currentStep === 2)
      return isPatient
        ? "Share your health information"
        : "Ready to start helping others";
    if (currentStep === 3) return "Connect with caregiver (optional)";
    return "";
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Complete Your Profile</Text>
        <Text style={styles.subtitle}>
          Step {currentStep + 1} of {TOTAL_STEPS}: {getStepTitle()}
        </Text>

        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                { width: `${((currentStep + 1) / TOTAL_STEPS) * 100}%` },
              ]}
            />
          </View>
        </View>
      </View>

      {renderStepContent()}

      <View style={styles.footer}>
        {currentStep === 0 && (
          <TouchableOpacity
            style={styles.fullWidthNextButton}
            onPress={handleNext}
            disabled={isLoading || !data.userData.userType}
          >
            <Text style={styles.nextButtonText}>
              {isLoading ? "Saving..." : "Continue"}
            </Text>
          </TouchableOpacity>
        )}

        {(currentStep === 1 ||
          (currentStep === 2 && data.userData.userType === "patient")) && (
          <>
            <TouchableOpacity
              style={styles.halfWidthBackButton}
              onPress={handleBack}
              disabled={isLoading}
            >
              <Text style={styles.backButtonText}>Back</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.halfWidthNextButton}
              onPress={handleNext}
              disabled={isLoading}
            >
              <Text style={styles.nextButtonText}>
                {isLoading ? "Saving..." : "Continue"}
              </Text>
            </TouchableOpacity>
          </>
        )}

        {currentStep === TOTAL_STEPS - 1 && (
          <>
            <TouchableOpacity
              style={styles.thirdWidthBackButton}
              onPress={handleBack}
              disabled={isLoading}
            >
              <Text style={styles.backButtonText}>Back</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.thirdWidthSkipButton}
              onPress={handleSkip}
              disabled={isLoading}
            >
              <Text style={styles.skipButtonText}>Skip</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.thirdWidthNextButton}
              onPress={handleNext}
              disabled={isLoading}
            >
              <Text style={styles.nextButtonText}>
                {isLoading ? "Saving..." : "Complete"}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  header: {
    padding: 24,
    paddingBottom: 16,
    backgroundColor: "white",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#0f172a",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#64748b",
    marginBottom: 20,
  },
  progressContainer: { marginTop: 8 },
  progressBar: {
    height: 6,
    backgroundColor: "#e2e8f0",
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#3b82f6",
    borderRadius: 3,
  },
  stepContent: {
    flex: 1,
    padding: 24,
  },
  stepTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#0f172a",
    marginBottom: 8,
  },
  stepDescription: {
    fontSize: 16,
    color: "#64748b",
    marginBottom: 32,
  },
  optionsContainer: { gap: 16, marginBottom: 32 },
  optionCard: {
    backgroundColor: "white",
    padding: 24,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "#e2e8f0",
  },
  selectedCard: {
    borderColor: "#3b82f6",
    backgroundColor: "#eff6ff",
  },
  disabledCard: { opacity: 0.6 },
  optionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  optionIcon: { fontSize: 32, marginRight: 16 },
  optionTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#0f172a",
  },
  optionDescription: {
    fontSize: 14,
    color: "#64748b",
    lineHeight: 20,
  },
  disabledText: { color: "#94a3b8" },
  comingSoonBadge: {
    position: "absolute",
    top: 12,
    right: 12,
    backgroundColor: "#fbbf24",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  comingSoonText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#92400e",
  },
  infoBox: {
    backgroundColor: "#f0f9ff",
    padding: 20,
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: "#0ea5e9",
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0369a1",
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: "#0c4a6e",
    lineHeight: 20,
  },
  form: { gap: 24 },
  inputGroup: { gap: 8 },
  label: {
    fontSize: 16,
    fontWeight: "600",
    color: "#374151",
  },
  input: {
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: "#0f172a",
  },
  textArea: { height: 100, textAlignVertical: "top" },
  helperText: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 4,
    marginLeft: 4,
  },
  phoneInputContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  countryCode: {
    backgroundColor: "#f1f5f9",
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
    borderWidth: 1,
    borderRightWidth: 0,
    borderColor: "#d1d5db",
  },
  countryCodeText: {
    fontSize: 16,
    color: "#374151",
    fontWeight: "500",
  },
  phoneInput: {
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
    flex: 1,
  },
  genderOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  genderOption: {
    flex: 1,
    minWidth: "45%",
    padding: 16,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 12,
    alignItems: "center",
  },
  genderSelected: {
    backgroundColor: "#3b82f6",
    borderColor: "#3b82f6",
  },
  genderText: {
    fontSize: 16,
    fontWeight: "500",
    color: "#374151",
  },
  genderTextSelected: { color: "white" },
  section: {
    backgroundColor: "#f8fafc",
    padding: 20,
    borderRadius: 16,
    gap: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#0f172a",
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 14,
    color: "#64748b",
    marginBottom: 16,
  },
  noteBox: {
    backgroundColor: "#fef3c7",
    padding: 16,
    borderRadius: 12,
    borderLeftWidth: 4,
    marginBottom: 50,
    borderLeftColor: "#f59e0b",
  },
  noteText: {
    fontSize: 14,
    color: "#92400e",
    lineHeight: 20,
  },
  inputWithButton: { flexDirection: "row", gap: 8 },
  flexInput: { flex: 1 },
  addButton: {
    backgroundColor: "#3b82f6",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    justifyContent: "center",
  },
  addButtonText: { color: "white", fontWeight: "600", fontSize: 14 },
  listContainer: { marginTop: 12, gap: 8 },
  listItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#f1f5f9",
    padding: 12,
    borderRadius: 8,
  },
  listItemText: {
    fontSize: 14,
    color: "#334155",
    flex: 1,
  },
  removeButton: { padding: 4 },
  removeButtonText: {
    fontSize: 14,
    color: "#ef4444",
    fontWeight: "bold",
  },
  row: { flexDirection: "row", gap: 12 },
  halfInput: { flex: 1 },
  bloodTypeContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  bloodTypeOption: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
  },
  bloodTypeSelected: {
    backgroundColor: "#3b82f6",
    borderColor: "#3b82f6",
  },
  bloodTypeText: {
    fontSize: 14,
    color: "#374151",
    fontWeight: "500",
  },
  bloodTypeTextSelected: { color: "white" },
  privacyNote: {
    backgroundColor: "#ecfdf5",
    padding: 16,
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: "#10b981",
  },
  privacyText: {
    fontSize: 14,
    color: "#065f46",
    lineHeight: 20,
  },
  centerContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  caregiverIconContainer: {
    backgroundColor: "#dbeafe",
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 24,
  },
  caregiverIcon: {
    fontSize: 50,
  },
  caregiverInfoCard: {
    backgroundColor: "#f0f9ff",
    padding: 24,
    borderRadius: 16,
    width: "100%",
    marginBottom: 24,
    borderWidth: 1,
    borderColor: "#bae6fd",
  },
  caregiverInfoTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#0369a1",
    marginBottom: 16,
  },
  benefitItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  benefitIcon: {
    fontSize: 20,
    marginRight: 12,
    marginTop: 2,
  },
  benefitText: {
    fontSize: 14,
    color: "#0c4a6e",
    flex: 1,
    lineHeight: 20,
  },
  comingSoonCard: {
    backgroundColor: "#fffbeb",
    padding: 24,
    borderRadius: 16,
    width: "100%",
    borderWidth: 1,
    borderColor: "#fde68a",
    marginBottom: 24,
  },
  comingSoonHeader: {
    alignItems: "center",
    marginBottom: 12,
  },
  comingSoonBadgeLarge: {
    backgroundColor: "#fbbf24",
    color: "#92400e",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    fontWeight: "600",
    fontSize: 14,
  },
  skipNote: {
    backgroundColor: "#f3f4f6",
    padding: 16,
    borderRadius: 12,
    width: "100%",
  },
  skipNoteText: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
    lineHeight: 20,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 16,
    backgroundColor: "white",
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    gap: 12,
  },
  backButton: {
    flex: 1,
    padding: 16,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 12,
    alignItems: "center",
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#374151",
  },

  skipButton: {
    flex: 1,
    padding: 16,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 12,
    alignItems: "center",
  },
  skipButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#6b7280",
  },
  nextButton: {
    flex: 1,
    padding: 16,
    backgroundColor: "#3b82f6",
    borderRadius: 12,
    alignItems: "center",
  },
  fullWidthButton: { flex: 0, width: "100%" },
  skipNextButton: {
    flex: 2, // Make it wider when skip button is visible
  },
  nextButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "white",
  },
  fullWidthNextButton: {
    width: "100%",
    padding: 16,
    backgroundColor: "#3b82f6",
    borderRadius: 12,
    alignItems: "center",
  },
  halfWidthBackButton: {
    flex: 1,
    padding: 16,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 12,
    alignItems: "center",
    minHeight: 56,
    justifyContent: "center",
  },
  halfWidthNextButton: {
    flex: 1,
    padding: 16,
    backgroundColor: "#3b82f6",
    borderRadius: 12,
    alignItems: "center",
    minHeight: 56,
    justifyContent: "center",
  },

  // Third width buttons for step 4
  thirdWidthBackButton: {
    flex: 1,
    padding: 12,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 12,
    alignItems: "center",
    minHeight: 52,
    justifyContent: "center",
  },

  thirdWidthSkipButton: {
    flex: 1,
    padding: 12,
    borderWidth: 1,
    borderColor: "#d1d5db",
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    alignItems: "center",
    minHeight: 52,
    justifyContent: "center",
  },

  thirdWidthNextButton: {
    flex: 1,
    padding: 12,
    backgroundColor: "#3b82f6",
    borderRadius: 12,
    alignItems: "center",
    minHeight: 52,
    justifyContent: "center",
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
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#0f172a",
    marginBottom: 16,
    textAlign: "center",
  },
  modalOption: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  modalOptionText: {
    fontSize: 16,
    color: "#0f172a",
    textAlign: "center",
  },
  // Replace these styles in your StyleSheet
  datePickerContainer: {
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
  },
  datePickerColumn: {
    flex: 1,
  },
  datePickerLabel: {
    fontSize: 12,
    fontWeight: "500",
    color: "#64748b",
    marginBottom: 8,
    textAlign: "center",
  },
  dropdownButton: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 12,
    padding: 12,
    minHeight: 50,
  },
  dropdownButtonText: {
    fontSize: 14,
    color: "#0f172a",
  },
  dropdownArrow: {
    fontSize: 12,
    color: "#64748b",
  },
  medicalSection: {
    backgroundColor: "white",
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  medicalSectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a",
    marginBottom: 4,
  },
  medicalSectionSubtitle: {
    fontSize: 14,
    color: "#64748b",
    marginBottom: 16,
    lineHeight: 20,
  },
  medicalRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  medicalHalfInput: {
    flex: 1,
  },
  tagContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 8,
  },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f1f5f9",
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
    gap: 6,
  },
  tagText: {
    fontSize: 14,
    color: "#334155",
  },
  tagRemove: {
    padding: 2,
  },
  addButtonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
  },
  addInput: {
    flex: 1,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    padding: 12,
    fontSize: 15,
    color: "#0f172a",
  },
  addActionButton: {
    backgroundColor: "#3b82f6",
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
    justifyContent: "center",
  },
  addActionButtonText: {
    color: "white",
    fontWeight: "600",
    fontSize: 14,
  },
  warningCard: {
    backgroundColor: "#fef2f2",
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
    borderLeftWidth: 3,
    borderLeftColor: "#ef4444",
  },
  warningText: {
    fontSize: 13,
    color: "#991b1b",
  },
  infoCard: {
    backgroundColor: "#eff6ff",
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
    borderLeftWidth: 3,
    borderLeftColor: "#3b82f6",
  },
  infoCardText: {
    fontSize: 13,
    color: "#1e40af",
  },
  divider: {
    height: 1,
    backgroundColor: "#e2e8f0",
    marginVertical: 16,
  },
  toggleGroup: {
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    alignItems: "center",
    backgroundColor: "white",
  },
  toggleButtonActive: {
    backgroundColor: "#3b82f6",
    borderColor: "#3b82f6",
  },
  toggleButtonText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#64748b",
  },
  toggleButtonTextActive: {
    color: "white",
  },
  pickerGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  pickerGridOption: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "white",
  },
  pickerGridOptionActive: {
    backgroundColor: "#3b82f6",
    borderColor: "#3b82f6",
  },
  pickerGridText: {
    fontSize: 13,
    color: "#374151",
  },
  pickerGridTextActive: {
    color: "white",
  },
  pregnancyCard: {
    backgroundColor: "#fdf2f8",
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#fbcfe8",
  },
  pregnancyTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#be185d",
    marginBottom: 12,
  },
  lifestyleCard: {
    backgroundColor: "#f0fdf4",
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#bbf7d0",
  },
  lifestyleTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#166534",
    marginBottom: 12,
  },
  bloodTypeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  bloodTypeGridOption: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "white",
  },
  bloodTypeGridOptionActive: {
    backgroundColor: "#3b82f6",
    borderColor: "#3b82f6",
  },
  bloodTypeGridText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#374151",
  },
  bloodTypeGridTextActive: {
    color: "white",
  },
  vitalCard: {
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  // Add these styles for the lifestyle options
  optionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 8,
  },
  optionChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: "#d1d5db",
    backgroundColor: "white",
  },
  optionChipActive: {
    backgroundColor: "#3b82f6",
    borderColor: "#3b82f6",
  },
  optionChipText: {
    fontSize: 14,
    color: "#374151",
    fontWeight: "500",
  },
  optionChipTextActive: {
    color: "white",
  },
  customGenderInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    color: Colors.text,
    marginTop: 8,
  },
  toggleContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  toggleOption: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  toggleActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  toggleText: {
    fontSize: 14,
    color: Colors.text,
    fontWeight: "500",
  },
  toggleTextActive: {
    color: Colors.surface,
  },
});
