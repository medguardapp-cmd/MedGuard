// app/(tabs)/more.tsx (updated with button)
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { signOut } from "firebase/auth";
import React from "react";
import {
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useOnboarding } from "../../contexts/OnboardingContext";
import { useAuth } from "../../hooks/useAuth";
import { auth } from "../../lib/firebase";

export default function MoreScreen() {
  const router = useRouter();
  const { data } = useOnboarding();
  const { user } = useAuth();

  const handleLogout = async () => {
    Alert.alert(
      "Logout",
      "Are you sure you want to logout?",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Logout",
          style: "destructive",
          onPress: async () => {
            try {
              await signOut(auth);
              router.replace("/(auth)/onboarding");
              console.log("User logged out successfully");
            } catch (error) {
              console.error("Error signing out:", error);
              Alert.alert("Error", "Failed to logout. Please try again.");
            }
          },
        },
      ],
      { cancelable: true },
    );
  };

  const getFirstName = () => {
    return data.userData.name.split(" ")[0] || "";
  };

  const getLastName = () => {
    const parts = data.userData.name.split(" ");
    return parts.length > 1 ? parts.slice(1).join(" ") : "";
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView>
        {/* Header with User Info */}
        <View style={styles.header}>
          <View style={styles.profileHeader}>
            <View style={styles.profileIcon}>
              <Ionicons name="person" size={32} color="#3b82f6" />
            </View>
            <View style={styles.profileInfo}>
              <Text style={styles.userName}>
                {getFirstName()} {getLastName()}
              </Text>
              <Text style={styles.userEmail}>{user?.email}</Text>
              <Text style={styles.userType}>
                {data.userData.userType === "patient"
                  ? "👤 Patient"
                  : "🤝 Caregiver"}
              </Text>
            </View>
          </View>
        </View>

        {/* Medication Logs Button - NEW */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.logsButton}
            onPress={() => router.push("/(tabs)/medication-logs")}
          >
            <View style={styles.logsButtonContent}>
              <View style={styles.logsIconContainer}>
                <Ionicons name="calendar" size={28} color="#3b82f6" />
              </View>
              <View style={styles.logsTextContainer}>
                <Text style={styles.logsTitle}>Medication Logs</Text>
                <Text style={styles.logsSubtitle}>
                  View your medication history and adherence
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#94a3b8" />
            </View>
          </TouchableOpacity>
        </View>

        {/* Personal Information Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Personal Information</Text>

          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Full Name</Text>
              <Text style={styles.infoValue}>
                {data.userData.name || "Not provided"}
              </Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Date of Birth</Text>
              <Text style={styles.infoValue}>
                {data.userData.dateOfBirth || "Not provided"}
              </Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Gender</Text>
              <Text style={styles.infoValue}>
                {data.userData.gender
                  ? data.userData.gender.charAt(0).toUpperCase() +
                    data.userData.gender.slice(1)
                  : "Not provided"}
              </Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Phone Number</Text>
              <Text style={styles.infoValue}>
                {data.userData.contactInfo?.phone
                  ? `+63 ${data.userData.contactInfo.phone}`
                  : "Not provided"}
              </Text>
            </View>
          </View>
        </View>

        {/* Medical Information Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Medical Information</Text>

          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Blood Type</Text>
              <Text style={styles.infoValue}>
                {data.medicalData.bloodType || "Not provided"}
              </Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Height</Text>
              <Text style={styles.infoValue}>
                {data.medicalData.height
                  ? `${data.medicalData.height} cm`
                  : "Not provided"}
              </Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Weight</Text>
              <Text style={styles.infoValue}>
                {data.medicalData.weight
                  ? `${data.medicalData.weight} kg`
                  : "Not provided"}
              </Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Medical Conditions</Text>
              <View style={styles.listContainer}>
                {data.medicalData.conditions.length > 0 ? (
                  data.medicalData.conditions.map((condition, index) => (
                    <View key={index} style={styles.listItem}>
                      <Text style={styles.listItemText}>• {condition}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.infoValue}>None provided</Text>
                )}
              </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Allergies</Text>
              <View style={styles.listContainer}>
                {data.medicalData.allergies.length > 0 ? (
                  data.medicalData.allergies.map((allergy, index) => (
                    <View key={index} style={styles.listItem}>
                      <Text style={styles.listItemText}>• {allergy}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.infoValue}>None provided</Text>
                )}
              </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Medications</Text>
              <View style={styles.listContainer}>
                {data.medicalData.medications.length > 0 ? (
                  data.medicalData.medications.map((medication, index) => (
                    <View key={index} style={styles.listItem}>
                      <Text style={styles.listItemText}>• {medication}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.infoValue}>None provided</Text>
                )}
              </View>
            </View>

            {data.medicalData.notes ? (
              <>
                <View style={styles.divider} />
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Additional Notes</Text>
                  <Text style={[styles.infoValue, styles.notesText]}>
                    {data.medicalData.notes}
                  </Text>
                </View>
              </>
            ) : null}
          </View>
        </View>

        {/* Actions Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account Actions</Text>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => router.push("/caregiver")}
          >
            <View style={styles.actionButtonContent}>
              <Ionicons name="people-outline" size={24} color="#3b82f6" />
              <Text style={styles.actionButtonText}>Caregiver</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#94a3b8" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionButton}>
            <View style={styles.actionButtonContent}>
              <Ionicons name="create-outline" size={24} color="#3b82f6" />
              <Text style={styles.actionButtonText}>Edit Profile</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#94a3b8" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionButton}>
            <View style={styles.actionButtonContent}>
              <Ionicons
                name="shield-checkmark-outline"
                size={24}
                color="#3b82f6"
              />
              <Text style={styles.actionButtonText}>Privacy Settings</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#94a3b8" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionButton}>
            <View style={styles.actionButtonContent}>
              <Ionicons
                name="notifications-outline"
                size={24}
                color="#3b82f6"
              />
              <Text style={styles.actionButtonText}>
                Notification Preferences
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#94a3b8" />
          </TouchableOpacity>
        </View>

        {/* Logout Section */}
        <View style={styles.logoutSection}>
          <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
            <View style={styles.logoutButtonContent}>
              <Ionicons name="log-out-outline" size={24} color="#ef4444" />
              <Text style={styles.logoutButtonText}>Logout</Text>
            </View>
          </TouchableOpacity>

          <Text style={styles.versionText}>MedGuard v1.0.0</Text>
          <Text style={styles.dataNotice}>
            🔒 Your data is securely stored in Firebase
          </Text>
        </View>
      </ScrollView>
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
    paddingBottom: 20,
    backgroundColor: "white",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  profileHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  profileIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#eff6ff",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#dbeafe",
  },
  profileInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#0f172a",
    marginBottom: 4,
  },
  userEmail: {
    fontSize: 14,
    color: "#64748b",
    marginBottom: 4,
  },
  userType: {
    fontSize: 14,
    color: "#3b82f6",
    fontWeight: "500",
  },
  section: {
    marginTop: 16,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 12,
    marginLeft: 8,
  },
  // Medication Logs Button Styles
  logsButton: {
    backgroundColor: "white",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    overflow: "hidden",
    marginBottom: 8,
  },
  logsButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 16,
  },
  logsIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#eff6ff",
    justifyContent: "center",
    alignItems: "center",
  },
  logsTextContainer: {
    flex: 1,
  },
  logsTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#0f172a",
    marginBottom: 4,
  },
  logsSubtitle: {
    fontSize: 13,
    color: "#64748b",
  },
  infoCard: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  infoRow: {
    paddingVertical: 12,
  },
  infoLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: "#64748b",
    marginBottom: 6,
  },
  infoValue: {
    fontSize: 16,
    color: "#0f172a",
  },
  notesText: {
    lineHeight: 22,
    color: "#475569",
  },
  divider: {
    height: 1,
    backgroundColor: "#f1f5f9",
  },
  listContainer: {
    marginTop: 4,
  },
  listItem: {
    marginBottom: 4,
  },
  listItemText: {
    fontSize: 16,
    color: "#0f172a",
    lineHeight: 22,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  actionButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  actionButtonText: {
    fontSize: 16,
    color: "#0f172a",
  },
  logoutSection: {
    marginTop: 32,
    marginBottom: 32,
    alignItems: "center",
  },
  logoutButton: {
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#fee2e2",
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    width: "90%",
    marginBottom: 24,
  },
  logoutButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  logoutButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ef4444",
  },
  versionText: {
    fontSize: 14,
    color: "#94a3b8",
    textAlign: "center",
    marginBottom: 8,
  },
  dataNotice: {
    fontSize: 12,
    color: "#64748b",
    textAlign: "center",
  },
});
