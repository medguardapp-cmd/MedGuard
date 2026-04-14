// app/edit-profile.tsx
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { doc, updateDoc } from "firebase/firestore";
import React, { useState } from "react";
import {
    ActivityIndicator,
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

// Genders for selection
const GENDERS = [
  { id: "male", label: "Male" },
  { id: "female", label: "Female" },
  { id: "other", label: "Other" },
  { id: "prefer-not-to-say", label: "Prefer not to say" },
];

export default function EditProfileScreen() {
  const router = useRouter();
  const { data, updateUserData } = useOnboarding();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [showGenderPicker, setShowGenderPicker] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    name: data.userData.name || "",
    dateOfBirth: data.userData.dateOfBirth || "",
    gender: data.userData.gender || "",
  });

  // Custom gender input
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

  // Helper to split name
  const getFirstName = () => {
    return formData.name.split(" ")[0] || "";
  };

  const getLastName = () => {
    const parts = formData.name.split(" ");
    return parts.length > 1 ? parts.slice(1).join(" ") : "";
  };

  const handleNameChange = (type: "first" | "last", value: string) => {
    const firstName = type === "first" ? value : getFirstName();
    const lastName = type === "last" ? value : getLastName();
    const fullName = `${firstName} ${lastName}`.trim();
    setFormData((prev) => ({ ...prev, name: fullName }));
  };

  const handleGenderSelect = (genderId: string) => {
    if (genderId === "other") {
      setShowCustomGender(true);
      setFormData((prev) => ({ ...prev, gender: "other" }));
      setCustomGender("");
    } else {
      setShowCustomGender(false);
      setFormData((prev) => ({ ...prev, gender: genderId }));
      setCustomGender("");
    }
    setShowGenderPicker(false);
  };

  const handleCustomGenderChange = (text: string) => {
    setCustomGender(text);
    setFormData((prev) => ({ ...prev, gender: text }));
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      Alert.alert("Error", "Please enter your name");
      return;
    }
    if (!formData.dateOfBirth) {
      Alert.alert("Error", "Please enter your date of birth");
      return;
    }
    if (!formData.gender) {
      Alert.alert("Error", "Please select your gender");
      return;
    }

    if (!user) {
      Alert.alert("Error", "User not authenticated");
      return;
    }

    setLoading(true);
    try {
      const userRef = doc(db, "users", user.uid);

      await updateDoc(userRef, {
        "userData.name": formData.name,
        "userData.dateOfBirth": formData.dateOfBirth,
        "userData.gender": formData.gender,
        "userData.updatedAt": new Date(),
        updatedAt: new Date(),
      });

      // Update local context
      updateUserData({
        name: formData.name,
        dateOfBirth: formData.dateOfBirth,
        gender: formData.gender,
      });

      Alert.alert("Success", "Profile updated successfully", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (error) {
      console.error("Error updating profile:", error);
      Alert.alert("Error", "Failed to update profile. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const formatDateInput = (text: string) => {
    const digits = text.replace(/\D/g, "");
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
    setFormData((prev) => ({ ...prev, dateOfBirth: formatted }));
  };

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

  const getDisplayGender = () => {
    if (!formData.gender) return "Select Gender";
    const found = GENDERS.find((g) => g.id === formData.gender);
    if (found) return found.label;
    return formData.gender; // Custom gender
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color="#0f172a" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <TouchableOpacity
          onPress={handleSave}
          style={styles.saveButton}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Text style={styles.saveButtonText}>Save</Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Profile Image Section */}
        <View style={styles.profileImageSection}>
          <View style={styles.profileImageContainer}>
            <View style={styles.profileImage}>
              <Text style={styles.profileInitials}>
                {getFirstName().charAt(0)}
                {getLastName().charAt(0)}
              </Text>
            </View>
            <TouchableOpacity style={styles.editImageButton}>
              <Ionicons name="camera" size={20} color="#ffffff" />
            </TouchableOpacity>
          </View>
          <Text style={styles.userEmail}>{user?.email}</Text>
        </View>

        {/* Form Section */}
        <View style={styles.form}>
          {/* First Name */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>First Name</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your first name"
              value={getFirstName()}
              onChangeText={handleFirstNameChange}
              autoCapitalize="words"
            />
          </View>

          {/* Last Name */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Last Name</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your last name"
              value={getLastName()}
              onChangeText={handleLastNameChange}
              autoCapitalize="words"
            />
          </View>

          {/* Date of Birth */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Date of Birth</Text>
            <TextInput
              style={styles.input}
              placeholder="YYYY-MM-DD"
              value={formData.dateOfBirth}
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
            <Text style={styles.label}>Gender</Text>
            <TouchableOpacity
              style={styles.genderButton}
              onPress={() => setShowGenderPicker(true)}
            >
              <Text style={styles.genderButtonText}>{getDisplayGender()}</Text>
              <Ionicons name="chevron-down" size={20} color="#64748b" />
            </TouchableOpacity>

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

          {/* Info Note */}
          <View style={styles.infoBox}>
            <Ionicons
              name="information-circle-outline"
              size={20}
              color="#3b82f6"
            />
            <Text style={styles.infoText}>
              Your email cannot be changed. Contact support if you need to
              update it.
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Gender Picker Modal */}
      <Modal
        visible={showGenderPicker}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowGenderPicker(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowGenderPicker(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select Gender</Text>
            {GENDERS.map((gender) => (
              <TouchableOpacity
                key={gender.id}
                style={styles.modalOption}
                onPress={() => handleGenderSelect(gender.id)}
              >
                <Text style={styles.modalOptionText}>{gender.label}</Text>
                {formData.gender === gender.id && (
                  <Ionicons name="checkmark" size={20} color="#3b82f6" />
                )}
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={styles.modalCloseButton}
              onPress={() => setShowGenderPicker(false)}
            >
              <Text style={styles.modalCloseText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8fafc",
    paddingBottom: 100,
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
    paddingTop: 50,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#0f172a",
  },
  saveButton: {
    backgroundColor: "#3b82f6",
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 8,
    minWidth: 60,
    alignItems: "center",
  },
  saveButtonText: {
    color: "white",
    fontWeight: "600",
    fontSize: 13,
  },
  profileImageSection: {
    alignItems: "center",
    paddingVertical: 24,
    backgroundColor: "white",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  profileImageContainer: {
    position: "relative",
    marginBottom: 12,
  },
  profileImage: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "#3b82f6",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 3,
    borderColor: "#ffffff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  profileInitials: {
    fontSize: 30,
    fontWeight: "600",
    color: "#ffffff",
  },
  editImageButton: {
    position: "absolute",
    bottom: 0,
    right: 0,
    backgroundColor: "#3b82f6",
    borderRadius: 20,
    padding: 8,
    borderWidth: 2,
    borderColor: "#ffffff",
  },
  userEmail: {
    fontSize: 13,
    color: "#64748b",
  },
  form: {
    padding: 20,
    gap: 20,
  },
  inputGroup: {
    gap: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: "#374151",
  },
  input: {
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 12,
    padding: 14,
    fontSize: 13,
    color: "#0f172a",
  },
  helperText: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 4,
    marginLeft: 4,
  },
  genderButton: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 12,
    padding: 14,
  },
  genderButtonText: {
    fontSize: 13,
    color: "#0f172a",
  },
  customGenderInput: {
    marginTop: 12,
  },
  infoBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#eff6ff",
    padding: 14,
    borderRadius: 12,
    marginTop: 10,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: "#1e40af",
    lineHeight: 18,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    backgroundColor: "white",
    borderRadius: 16,
    width: "80%",
    maxHeight: "70%",
    padding: 20,
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#0f172a",
    marginBottom: 16,
    textAlign: "center",
  },
  modalOption: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  modalOptionText: {
    fontSize: 14,
    color: "#0f172a",
  },
  modalCloseButton: {
    marginTop: 16,
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: 12,
    backgroundColor: "#f1f5f9",
  },
  modalCloseText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748b",
  },
});
