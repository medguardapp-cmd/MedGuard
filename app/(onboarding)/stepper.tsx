// app/(onboarding)/stepper.tsx - FIXED VERSION
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useAuth } from "../../hooks/useAuth";

export default function OnboardingStepper() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);

  // Move these useState hooks to the top level
  const [newCondition, setNewCondition] = useState("");
  const [newAllergy, setNewAllergy] = useState("");
  const [newMedication, setNewMedication] = useState("");

  const [data, setData] = useState({
    userType: "patient",
    firstName: "",
    lastName: "",
    dateOfBirth: "",
    gender: "",
    phone: "",
    conditions: [] as string[],
    allergies: [] as string[],
    medications: [] as string[],
    bloodType: "",
    height: "",
    weight: "",
    notes: "",
  });

  const { user } = useAuth();
  const TOTAL_STEPS = 4;

  const updateData = (key: string, value: any) => {
    setData((prev) => ({ ...prev, [key]: value }));
  };

  const completeOnboarding = async () => {
    try {
      console.log("Completing onboarding with data:", data);

      // Save to AsyncStorage
      if (user) {
        await AsyncStorage.setItem(
          `@medguard_onboarding_completed_${user.uid}`,
          "true",
        );
        await AsyncStorage.setItem(
          `@medguard_user_data_${user.uid}`,
          JSON.stringify(data),
        );
      }

      return true;
    } catch (error) {
      console.error("Error completing onboarding:", error);
      throw error;
    }
  };

  const handleNext = () => {
    // Validate current step
    if (currentStep === 0 && !data.userType) {
      Alert.alert("Error", "Please select a user type");
      return;
    }

    if (currentStep === 1) {
      if (!data.firstName.trim()) {
        Alert.alert("Error", "Please enter your first name");
        return;
      }
      if (!data.lastName.trim()) {
        Alert.alert("Error", "Please enter your last name");
        return;
      }
      if (!data.dateOfBirth) {
        Alert.alert("Error", "Please enter your date of birth");
        return;
      }
      if (data.dateOfBirth.length !== 10) {
        Alert.alert("Error", "Please enter a complete date (YYYY-MM-DD)");
        return;
      }
      if (!data.gender) {
        Alert.alert("Error", "Please select your gender");
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

  const handleSkip = () => {
    if (currentStep < TOTAL_STEPS - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  const handleComplete = async () => {
    setLoading(true);
    try {
      await completeOnboarding();
      router.replace("/(tabs)");
    } catch (error) {
      console.error("Error completing onboarding:", error);
      Alert.alert(
        "Error",
        "Failed to save your information. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  // Step 1: User Type
  const renderStep1 = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>How will you use MedGuard?</Text>
      <Text style={styles.stepDescription}>
        Select your role to customize your experience
      </Text>

      <View style={styles.optionsContainer}>
        {/* Patient Option */}
        <TouchableOpacity
          style={[
            styles.optionCard,
            data.userType === "patient" && styles.selectedCard,
          ]}
          onPress={() => updateData("userType", "patient")}
        >
          <View style={styles.optionHeader}>
            <Text style={styles.optionIcon}>👤</Text>
            <Text style={styles.optionTitle}>Patient</Text>
          </View>
          <Text style={styles.optionDescription}>
            I'm managing my own health
          </Text>
        </TouchableOpacity>

        {/* Caregiver Option (Disabled) */}
        <View style={[styles.optionCard, styles.disabledCard]}>
          <View style={styles.optionHeader}>
            <Text style={styles.optionIcon}>🤝</Text>
            <Text style={styles.optionTitle}>Caregiver</Text>
          </View>
          <Text style={[styles.optionDescription, styles.disabledText]}>
            I'm caring for someone else
          </Text>
          <View style={styles.comingSoonBadge}>
            <Text style={styles.comingSoonText}>Coming Soon</Text>
          </View>
        </View>
      </View>

      <View style={styles.infoBox}>
        <Text style={styles.infoTitle}>About Patient Mode:</Text>
        <Text style={styles.infoText}>
          • Track your medications and appointments
          {"\n"}• Monitor your health metrics
          {"\n"}• Store your medical records securely
          {"\n"}• Get medication reminders
        </Text>
      </View>
    </View>
  );

  // Step 2: Personal Info
  const renderStep2 = () => {
    const genders = [
      { id: "male", label: "Male" },
      { id: "female", label: "Female" },
      { id: "other", label: "Other" },
      { id: "prefer-not-to-say", label: "Prefer not to say" },
    ];

    // Format date as user types (auto-add dashes)
    const formatDateInput = (text: string) => {
      // Remove all non-digits
      const digits = text.replace(/\D/g, "");

      // Format as YYYY-MM-DD
      if (digits.length <= 4) {
        return digits;
      } else if (digits.length <= 6) {
        return `${digits.slice(0, 4)}-${digits.slice(4)}`;
      } else {
        return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
      }
    };

    const handleDateChange = (text: string) => {
      const formatted = formatDateInput(text);
      updateData("dateOfBirth", formatted);
    };

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
          {/* First Name */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>First Name *</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your first name"
              value={data.firstName}
              onChangeText={(text) => updateData("firstName", text)}
              autoCapitalize="words"
            />
          </View>

          {/* Last Name */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Last Name *</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your last name"
              value={data.lastName}
              onChangeText={(text) => updateData("lastName", text)}
              autoCapitalize="words"
            />
          </View>

          {/* Date of Birth */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Date of Birth *</Text>
            <TextInput
              style={styles.input}
              placeholder="YYYY-MM-DD"
              value={data.dateOfBirth}
              onChangeText={handleDateChange}
              keyboardType="number-pad"
              maxLength={10}
            />
            <Text style={styles.helperText}>
              Format: Year-Month-Day (e.g., 1990-01-15)
            </Text>
          </View>

          {/* Gender */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Gender *</Text>
            <View style={styles.genderOptions}>
              {genders.map((gender) => (
                <TouchableOpacity
                  key={gender.id}
                  style={[
                    styles.genderOption,
                    data.gender === gender.id && styles.genderSelected,
                  ]}
                  onPress={() => updateData("gender", gender.id)}
                >
                  <Text
                    style={[
                      styles.genderText,
                      data.gender === gender.id && styles.genderTextSelected,
                    ]}
                  >
                    {gender.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Contact Information - PHILIPPINES SPECIFIC */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Contact Information 🇵🇭</Text>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Mobile Number</Text>
              <View style={styles.phoneInputContainer}>
                <View style={styles.countryCode}>
                  <Text style={styles.countryCodeText}>+63</Text>
                </View>
                <TextInput
                  style={[styles.input, styles.phoneInput]}
                  placeholder="912 345 6789"
                  value={data.phone}
                  onChangeText={(text) => {
                    // Remove non-digits and limit to 10 digits
                    const digits = text.replace(/\D/g, "").slice(0, 10);
                    // Format as 912 345 6789
                    let formatted = "";
                    if (digits.length > 0) formatted = digits;
                    if (digits.length > 3)
                      formatted = `${digits.slice(0, 3)} ${digits.slice(3)}`;
                    if (digits.length > 6)
                      formatted = `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
                    updateData("phone", formatted);
                  }}
                  keyboardType="phone-pad"
                  maxLength={12} // 3 groups of 3 digits + 2 spaces
                />
              </View>
              <Text style={styles.helperText}>
                Philippines mobile number (e.g., 912 345 6789)
              </Text>
            </View>
          </View>

          <View style={styles.noteBox}>
            <Text style={styles.noteText}>
              * Required fields. All information is stored securely.
            </Text>
          </View>
        </View>
      </ScrollView>
    );
  };

  // Step 3: Medical Info
  const renderStep3 = () => {
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

    const addCondition = () => {
      if (
        newCondition.trim() &&
        !data.conditions.includes(newCondition.trim())
      ) {
        updateData("conditions", [...data.conditions, newCondition.trim()]);
        setNewCondition("");
      }
    };

    const removeCondition = (index: number) => {
      const updated = [...data.conditions];
      updated.splice(index, 1);
      updateData("conditions", updated);
    };

    const addAllergy = () => {
      if (newAllergy.trim() && !data.allergies.includes(newAllergy.trim())) {
        updateData("allergies", [...data.allergies, newAllergy.trim()]);
        setNewAllergy("");
      }
    };

    const removeAllergy = (index: number) => {
      const updated = [...data.allergies];
      updated.splice(index, 1);
      updateData("allergies", updated);
    };

    const addMedication = () => {
      if (
        newMedication.trim() &&
        !data.medications.includes(newMedication.trim())
      ) {
        updateData("medications", [...data.medications, newMedication.trim()]);
        setNewMedication("");
      }
    };

    const removeMedication = (index: number) => {
      const updated = [...data.medications];
      updated.splice(index, 1);
      updateData("medications", updated);
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
          {/* Medical Conditions */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Medical Conditions</Text>
            <Text style={styles.sectionDescription}>
              List any chronic or ongoing medical conditions
            </Text>

            <View style={styles.inputWithButton}>
              <TextInput
                style={[styles.input, styles.flexInput]}
                placeholder="e.g., Diabetes, Hypertension"
                value={newCondition}
                onChangeText={setNewCondition}
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

            {data.conditions.length > 0 && (
              <View style={styles.listContainer}>
                {data.conditions.map((condition, index) => (
                  <View key={index} style={styles.listItem}>
                    <Text style={styles.listItemText}>{condition}</Text>
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

          {/* Allergies */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Allergies</Text>
            <Text style={styles.sectionDescription}>
              List any allergies (medications, food, environmental)
            </Text>

            <View style={styles.inputWithButton}>
              <TextInput
                style={[styles.input, styles.flexInput]}
                placeholder="e.g., Penicillin, Peanuts"
                value={newAllergy}
                onChangeText={setNewAllergy}
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

            {data.allergies.length > 0 && (
              <View style={styles.listContainer}>
                {data.allergies.map((allergy, index) => (
                  <View key={index} style={styles.listItem}>
                    <Text style={styles.listItemText}>{allergy}</Text>
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

          {/* Current Medications */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Current Medications</Text>
            <Text style={styles.sectionDescription}>
              List medications you're currently taking
            </Text>

            <View style={styles.inputWithButton}>
              <TextInput
                style={[styles.input, styles.flexInput]}
                placeholder="e.g., Metformin 500mg, Lisinopril 10mg"
                value={newMedication}
                onChangeText={setNewMedication}
                onSubmitEditing={addMedication}
              />
              <TouchableOpacity
                style={styles.addButton}
                onPress={addMedication}
                disabled={!newMedication.trim()}
              >
                <Text style={styles.addButtonText}>Add</Text>
              </TouchableOpacity>
            </View>

            {data.medications.length > 0 && (
              <View style={styles.listContainer}>
                {data.medications.map((medication, index) => (
                  <View key={index} style={styles.listItem}>
                    <Text style={styles.listItemText}>{medication}</Text>
                    <TouchableOpacity
                      onPress={() => removeMedication(index)}
                      style={styles.removeButton}
                    >
                      <Text style={styles.removeButtonText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Vital Information */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Vital Information</Text>

            <View style={styles.row}>
              <View style={styles.halfInput}>
                <Text style={styles.label}>Blood Type</Text>
                <View style={styles.bloodTypeContainer}>
                  {bloodTypes.map((type) => (
                    <TouchableOpacity
                      key={type}
                      style={[
                        styles.bloodTypeOption,
                        data.bloodType === type && styles.bloodTypeSelected,
                      ]}
                      onPress={() => updateData("bloodType", type)}
                    >
                      <Text
                        style={[
                          styles.bloodTypeText,
                          data.bloodType === type &&
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
                  placeholder="175"
                  value={data.height}
                  onChangeText={(text) => updateData("height", text)}
                  keyboardType="numeric"
                />
              </View>

              <View style={styles.halfInput}>
                <Text style={styles.label}>Weight (kg)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="70"
                  value={data.weight}
                  onChangeText={(text) => updateData("weight", text)}
                  keyboardType="numeric"
                />
              </View>
            </View>
          </View>

          {/* Additional Notes */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Additional Notes</Text>
            <Text style={styles.sectionDescription}>
              Any other important medical information
            </Text>

            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="e.g., Previous surgeries, family medical history, etc."
              value={data.notes}
              onChangeText={(text) => updateData("notes", text)}
              multiline
              numberOfLines={4}
            />
          </View>

          <View style={styles.privacyNote}>
            <Text style={styles.privacyText}>
              🔒 Your medical information is encrypted and stored securely.
            </Text>
          </View>
        </View>
      </ScrollView>
    );
  };

  // Step 4: Connect Caregiver (UI Only - Skip Option)
  const renderStep4 = () => (
    <ScrollView style={styles.stepContent} showsVerticalScrollIndicator={false}>
      <View style={styles.centerContent}>
        <View style={styles.caregiverIconContainer}>
          <Text style={styles.caregiverIcon}>👨‍👩‍👧‍👦</Text>
        </View>

        <Text style={styles.stepTitle}>Connect with Caregiver</Text>
        <Text style={styles.stepDescription}>
          Optionally connect with a family member or caregiver who can help
          manage your health
        </Text>

        <View style={styles.caregiverInfoCard}>
          <Text style={styles.caregiverInfoTitle}>Caregiver Benefits:</Text>
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

        <TouchableOpacity style={styles.comingSoonCard} disabled={true}>
          <View style={styles.comingSoonHeader}>
            <Text style={styles.comingSoonBadgeLarge}>Coming Soon</Text>
          </View>
          <Text style={styles.comingSoonText}>
            Caregiver connection feature will be available in the next update.
            You can always add a caregiver later from Settings.
          </Text>
        </TouchableOpacity>

        <View style={styles.skipNote}>
          <Text style={styles.skipNoteText}>
            You can skip this step and add a caregiver later when the feature is
            available.
          </Text>
        </View>
      </View>
    </ScrollView>
  );

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return renderStep1();
      case 1:
        return renderStep2();
      case 2:
        return renderStep3();
      case 3:
        return renderStep4();
      default:
        return null;
    }
  };

  const steps = [
    {
      id: 1,
      title: "User Type",
      description: "Select how you will use MedGuard",
    },
    { id: 2, title: "Personal Info", description: "Tell us about yourself" },
    {
      id: 3,
      title: "Medical Info",
      description: "Share your health information",
    },
    {
      id: 4,
      title: "Caregiver",
      description: "Connect with caregiver (optional)",
    },
  ];

  // In your stepper.tsx, replace the return statement footer section with this:

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Complete Your Profile</Text>
        <Text style={styles.subtitle}>
          Step {currentStep + 1} of {TOTAL_STEPS}: {steps[currentStep].title}
        </Text>

        {/* Progress Bar */}
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

      {/* Step Content */}
      {renderStepContent()}

      {/* Navigation Footer - UPDATED BUTTON LAYOUT */}
      <View style={styles.footer}>
        {/* Step 1: Only Next button */}
        {currentStep === 0 && (
          <TouchableOpacity
            style={styles.fullWidthNextButton}
            onPress={handleNext}
            disabled={loading}
          >
            <Text style={styles.nextButtonText}>Continue</Text>
          </TouchableOpacity>
        )}

        {/* Step 2-3: Back + Next buttons */}
        {(currentStep === 1 || currentStep === 2) && (
          <>
            <TouchableOpacity
              style={styles.halfWidthBackButton}
              onPress={handleBack}
              disabled={loading}
            >
              <Text style={styles.backButtonText}>Back</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.halfWidthNextButton}
              onPress={handleNext}
              disabled={loading}
            >
              <Text style={styles.nextButtonText}>Continue</Text>
            </TouchableOpacity>
          </>
        )}

        {/* Step 4 (Last): Back + Skip + Next buttons */}
        {currentStep === TOTAL_STEPS - 1 && (
          <>
            <TouchableOpacity
              style={styles.thirdWidthBackButton}
              onPress={handleBack}
              disabled={loading}
            >
              <Text style={styles.backButtonText}>Back</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.thirdWidthSkipButton}
              onPress={handleSkip}
              disabled={loading}
            >
              <Text style={styles.skipButtonText}>Skip</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.thirdWidthNextButton}
              onPress={handleNext}
              disabled={loading}
            >
              <Text style={styles.nextButtonText}>
                {loading ? "Saving..." : "Complete"}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

// Keep the same styles object from your previous code
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
});
