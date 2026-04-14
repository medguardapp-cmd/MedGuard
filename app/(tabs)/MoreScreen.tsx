// app/(tabs)/more.tsx
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
        { text: "Cancel", style: "cancel" },
        {
          text: "Logout",
          style: "destructive",
          onPress: async () => {
            try {
              await signOut(auth);
              router.replace("/(auth)/onboarding");
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

  const getFirstName = () => data.userData.name.split(" ")[0] || "";
  const getLastName = () => {
    const parts = data.userData.name.split(" ");
    return parts.length > 1 ? parts.slice(1).join(" ") : "";
  };

  const getUserInitials = () => {
    const firstName = getFirstName();
    const lastName = getLastName();
    return `${firstName.charAt(0)}${lastName.charAt(0) || ""}`.toUpperCase();
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Profile Header Section */}
        <View style={styles.profileSection}>
          <View style={styles.profileImageContainer}>
            <View style={styles.profileImage}>
              <Text style={styles.profileInitials}>{getUserInitials()}</Text>
            </View>
            <TouchableOpacity style={styles.editProfileIcon}>
              <Ionicons name="camera" size={20} color="#ffffff" />
            </TouchableOpacity>
          </View>

          <Text style={styles.userName}>
            {data.userData.name || "User Name"}
          </Text>
          <Text style={styles.userEmail}>{user?.email || "No email"}</Text>

          <View style={styles.userTypeBadge}>
            <Ionicons
              name={
                data.userData.userType === "patient"
                  ? "person-outline"
                  : "people-outline"
              }
              size={14}
              color="#3b82f6"
            />
            <Text style={styles.userTypeText}>
              {data.userData.userType === "patient" ? "Patient" : "Caregiver"}
            </Text>
          </View>

          <TouchableOpacity
            style={styles.editProfileButton}
            onPress={() => router.push("/edit-profile")}
          >
            <Ionicons name="create-outline" size={18} color="#3b82f6" />
            <Text style={styles.editProfileButtonText}>Edit Profile</Text>
          </TouchableOpacity>
        </View>

        {/* Patient Information - Clickable Card */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.navButton}
            onPress={() => router.push("/patient-info")} // Changed: removed (tabs) from path
          >
            <View style={styles.navButtonLeft}>
              <View style={styles.navButtonIcon}>
                <Ionicons name="medical-outline" size={24} color="#3b82f6" />
              </View>
              <View>
                <Text style={styles.navButtonTitle}>Patient Information</Text>
                <Text style={styles.navButtonSubtitle}>
                  View personal and medical details
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#94a3b8" />
          </TouchableOpacity>
        </View>

        {/* Caregiver Section */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.navButton}
            onPress={() => router.push("/caregiver")}
          >
            <View style={styles.navButtonLeft}>
              <View style={styles.navButtonIcon}>
                <Ionicons name="people-outline" size={24} color="#3b82f6" />
              </View>
              <View>
                <Text style={styles.navButtonTitle}>Caregiver</Text>
                <Text style={styles.navButtonSubtitle}>
                  Manage caregiver access and permissions
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#94a3b8" />
          </TouchableOpacity>
        </View>

        {/* Medication Logs Section */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.navButton}
            onPress={() => router.push("/(tabs)/medication-logs")}
          >
            <View style={styles.navButtonLeft}>
              <View style={styles.navButtonIcon}>
                <Ionicons name="calendar-outline" size={24} color="#3b82f6" />
              </View>
              <View>
                <Text style={styles.navButtonTitle}>Medication Logs</Text>
                <Text style={styles.navButtonSubtitle}>
                  View medication history and adherence
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#94a3b8" />
          </TouchableOpacity>
        </View>

        {/* Settings Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="settings-outline" size={22} color="#64748b" />
            <Text style={styles.sectionTitle}>Settings</Text>
          </View>

          <TouchableOpacity style={styles.settingItem}>
            <View style={styles.settingItemLeft}>
              <Ionicons
                name="notifications-outline"
                size={22}
                color="#64748b"
              />
              <Text style={styles.settingItemText}>
                Notification Preferences
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#94a3b8" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.settingItem}>
            <View style={styles.settingItemLeft}>
              <Ionicons
                name="shield-checkmark-outline"
                size={22}
                color="#64748b"
              />
              <Text style={styles.settingItemText}>Privacy & Security</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#94a3b8" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.settingItem}>
            <View style={styles.settingItemLeft}>
              <Ionicons name="help-circle-outline" size={22} color="#64748b" />
              <Text style={styles.settingItemText}>Help & Support</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#94a3b8" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.settingItem}>
            <View style={styles.settingItemLeft}>
              <Ionicons
                name="information-circle-outline"
                size={22}
                color="#64748b"
              />
              <Text style={styles.settingItemText}>About MedGuard</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#94a3b8" />
          </TouchableOpacity>
        </View>

        {/* Logout Section */}
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={22} color="#ef4444" />
          <Text style={styles.logoutButtonText}>Logout</Text>
        </TouchableOpacity>

        <View style={styles.footer}>
          <Text style={styles.versionText}>MedGuard v1.0.0</Text>
          <Text style={styles.dataNotice}>🔒 Your data is securely stored</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8fafc",
    paddingBottom: 100,
  },
  profileSection: {
    alignItems: "center",
    paddingTop: 100,
    paddingBottom: 24,
    backgroundColor: "white",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  profileImageContainer: {
    position: "relative",
    marginBottom: 16,
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
  editProfileIcon: {
    position: "absolute",
    bottom: 0,
    right: 0,
    backgroundColor: "#3b82f6",
    borderRadius: 20,
    padding: 6,
    borderWidth: 2,
    borderColor: "#ffffff",
  },
  userName: {
    fontSize: 20,
    fontWeight: "700",
    color: "#0f172a",
    marginBottom: 4,
  },
  userEmail: {
    fontSize: 12,
    color: "#64748b",
    marginBottom: 8,
  },
  userTypeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#eff6ff",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
    marginBottom: 16,
  },
  userTypeText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#3b82f6",
  },
  editProfileButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#f8fafc",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  editProfileButtonText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#3b82f6",
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
    fontSize: 13,
    fontWeight: "600",
    color: "#475569",
  },
  navButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  navButtonLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    flex: 1,
  },
  navButtonIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#eff6ff",
    justifyContent: "center",
    alignItems: "center",
  },
  navButtonTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#0f172a",
    marginBottom: 2,
  },
  navButtonSubtitle: {
    fontSize: 10,
    color: "#64748b",
  },
  settingItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  settingItemLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  settingItemText: {
    fontSize: 13,
    color: "#0f172a",
  },
  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "white",
    marginTop: 24,
    marginHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#fee2e2",
  },
  logoutButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ef4444",
  },
  footer: {
    alignItems: "center",
    paddingVertical: 24,
  },
  versionText: {
    fontSize: 12,
    color: "#94a3b8",
    marginBottom: 4,
  },
  dataNotice: {
    fontSize: 11,
    color: "#cbd5e1",
  },
});
