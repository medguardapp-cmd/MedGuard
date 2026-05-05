// app/(caregiver-only)/connect.tsx
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Colors from "../../constants/colors";
import { useOnboarding } from "../../contexts/OnboardingContext";
import { useAuth } from "../../hooks/useAuth";
import { db } from "../../lib/firebase";

interface PendingRequest {
  id: string;
  patientId: string;
  patientName: string;
  patientEmail: string;
  status: string;
  connectedAt: any;
}

export default function CaregiverConnectScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { data } = useOnboarding();
  const [inputCode, setInputCode] = useState("");
  const [connectingCode, setConnectingCode] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);

  // Fetch pending requests
  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, "caregiver_connections"),
      where("caregiverId", "==", user.uid),
      where("status", "==", "pending"),
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const requests = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as PendingRequest[];
      setPendingRequests(requests);
      setLoadingRequests(false);
    });

    return unsubscribe;
  }, [user]);

  const handleConnect = async () => {
    const code = inputCode.trim().toUpperCase();
    if (code.length !== 6) {
      Alert.alert("Invalid Code", "Please enter a valid 6-character code.");
      return;
    }
    if (!user) return;

    setConnectingCode(true);
    try {
      const usersSnap = await getDocs(
        query(collection(db, "users"), where("caregiverCode", "==", code)),
      );

      if (usersSnap.empty) {
        Alert.alert(
          "Code Not Found",
          "No patient found with that code. Please check and try again.",
        );
        setConnectingCode(false);
        return;
      }

      const patientDoc = usersSnap.docs[0];
      const patientId = patientDoc.id;
      const patientData = patientDoc.data();

      // Check if code is expired
      const expiresAt = patientData.caregiverCodeExpiresAt;
      if (expiresAt?.toDate && expiresAt.toDate() < new Date()) {
        Alert.alert(
          "Code Expired",
          "This patient's code has expired. Ask them to generate a new code.",
        );
        setConnectingCode(false);
        return;
      }

      if (patientId === user.uid) {
        Alert.alert("Invalid", "You cannot connect to yourself.");
        setConnectingCode(false);
        return;
      }

      // Check existing connection
      const existingSnap = await getDocs(
        query(
          collection(db, "caregiver_connections"),
          where("patientId", "==", patientId),
          where("caregiverId", "==", user.uid),
        ),
      );

      if (!existingSnap.empty) {
        const existing = existingSnap.docs[0].data();
        if (existing.status === "pending") {
          Alert.alert(
            "Request Sent",
            "You already have a pending request with this patient.",
          );
        } else if (existing.status === "approved") {
          Alert.alert(
            "Already Connected",
            "You are already connected to this patient.",
          );
        } else if (existing.status === "rejected") {
          // Allow re-request
          await updateDoc(
            doc(db, "caregiver_connections", existingSnap.docs[0].id),
            {
              status: "pending",
              connectedAt: serverTimestamp(),
            },
          );
          Alert.alert(
            "Request Sent!",
            `Your request has been resent to ${patientData.name ?? "the patient"}.`,
          );
        }
        setConnectingCode(false);
        return;
      }

      await addDoc(collection(db, "caregiver_connections"), {
        patientId,
        caregiverId: user.uid,
        patientName: patientData.name ?? "Unknown Patient",
        patientEmail: patientData.email ?? "",
        caregiverName: data.userData.name,
        caregiverEmail: user.email,
        connectedAt: serverTimestamp(),
        status: "pending",
        permissions: "view_only",
      });

      setInputCode("");
      Alert.alert(
        "Request Sent!",
        `Your request has been sent to ${patientData.name ?? "the patient"}. Waiting for their approval.`,
      );
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Failed to send request.");
    }
    setConnectingCode(false);
  };

  const handleCancelRequest = async (
    requestId: string,
    patientName: string,
  ) => {
    Alert.alert(
      "Cancel Request",
      `Are you sure you want to cancel your request to ${patientName}?`,
      [
        { text: "No", style: "cancel" },
        {
          text: "Yes, Cancel",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteDoc(doc(db, "caregiver_connections", requestId));
              Alert.alert(
                "Request Cancelled",
                "Your request has been cancelled.",
              );
            } catch (error) {
              Alert.alert(
                "Error",
                "Failed to cancel request. Please try again.",
              );
            }
          },
        },
      ],
    );
  };

  const formatDate = (timestamp: any) => {
    if (!timestamp?.toDate) return "Recently";
    const date = timestamp.toDate();
    const now = new Date();
    const diffDays = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;

    return date.toLocaleDateString();
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.iconContainer}>
            <Ionicons name="people" size={80} color={Colors.primary + "40"} />
          </View>
          <Text style={styles.title}>Connect to a Patient</Text>
          <Text style={styles.subtitle}>
            Enter the 6-character code provided by the patient to start helping
            them manage their medications.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Patient Code</Text>
          <Text style={styles.cardSubtitle}>
            Ask the patient to share their caregiver code from their app
          </Text>

          <View style={styles.inputContainer}>
            <TextInput
              style={styles.codeInput}
              value={inputCode}
              onChangeText={(t) => setInputCode(t.toUpperCase())}
              placeholder="e.g., AB3X7K"
              placeholderTextColor={Colors.textTertiary}
              maxLength={6}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={[
                styles.connectButton,
                (connectingCode || inputCode.length !== 6) &&
                  styles.connectButtonDisabled,
              ]}
              onPress={handleConnect}
              disabled={connectingCode || inputCode.length !== 6}
            >
              {connectingCode ? (
                <ActivityIndicator size="small" color={Colors.surface} />
              ) : (
                <>
                  <Ionicons name="send" size={18} color={Colors.surface} />
                  <Text style={styles.connectButtonText}>Send Request</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Pending Requests Section */}
        {!loadingRequests && pendingRequests.length > 0 && (
          <View style={styles.pendingSection}>
            <View style={styles.pendingHeader}>
              <Text style={styles.pendingTitle}>Pending Requests</Text>
              <View style={styles.pendingBadge}>
                <Text style={styles.pendingBadgeText}>
                  {pendingRequests.length}
                </Text>
              </View>
            </View>

            {pendingRequests.map((request) => (
              <View key={request.id} style={styles.pendingCard}>
                <View style={styles.pendingInfo}>
                  <View style={styles.pendingAvatar}>
                    <Text style={styles.pendingAvatarText}>
                      {request.patientName?.charAt(0)?.toUpperCase() || "P"}
                    </Text>
                  </View>
                  <View style={styles.pendingDetails}>
                    <Text style={styles.pendingPatientName}>
                      {request.patientName}
                    </Text>
                    <Text style={styles.pendingPatientEmail}>
                      {request.patientEmail}
                    </Text>
                    <Text style={styles.pendingDate}>
                      Requested {formatDate(request.connectedAt)}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={() =>
                    handleCancelRequest(request.id, request.patientName)
                  }
                >
                  <Ionicons
                    name="close-circle"
                    size={22}
                    color={Colors.error}
                  />
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <View style={styles.infoBox}>
          <Ionicons
            name="information-circle"
            size={20}
            color={Colors.primary}
          />
          <Text style={styles.infoText}>
            The patient will need to approve your request before you can see
            their information. You'll be notified once approved.
          </Text>
        </View>

        <View style={styles.stepsCard}>
          <Text style={styles.stepsTitle}>How it works:</Text>
          <View style={styles.stepItem}>
            <View style={styles.stepNumber}>
              <Text style={styles.stepNumberText}>1</Text>
            </View>
            <Text style={styles.stepText}>
              Ask the patient for their 6-character code
            </Text>
          </View>
          <View style={styles.stepItem}>
            <View style={styles.stepNumber}>
              <Text style={styles.stepNumberText}>2</Text>
            </View>
            <Text style={styles.stepText}>
              Enter the code above and send a request
            </Text>
          </View>
          <View style={styles.stepItem}>
            <View style={styles.stepNumber}>
              <Text style={styles.stepNumberText}>3</Text>
            </View>
            <Text style={styles.stepText}>
              Patient approves your request with chosen permissions
            </Text>
          </View>
          <View style={styles.stepItem}>
            <View style={styles.stepNumber}>
              <Text style={styles.stepNumberText}>4</Text>
            </View>
            <Text style={styles.stepText}>
              Start helping manage their medications
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingBottom: 50,
  },
  scrollContent: {
    padding: 20,
  },
  header: {
    alignItems: "center",
    marginBottom: 24,
  },
  iconContainer: {
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: Colors.text,
    marginBottom: 8,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: Colors.text,
    marginBottom: 4,
  },
  cardSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 20,
  },
  inputContainer: {
    flexDirection: "row",
    gap: 12,
  },
  codeInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 16,
    fontSize: 20,
    fontWeight: "600",
    textAlign: "center",
    letterSpacing: 4,
    backgroundColor: Colors.background,
    color: Colors.text,
  },
  connectButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.primary,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  connectButtonDisabled: {
    opacity: 0.5,
  },
  connectButtonText: {
    color: Colors.surface,
    fontWeight: "600",
    fontSize: 14,
  },
  pendingSection: {
    marginBottom: 20,
  },
  pendingHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  pendingTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.text,
  },
  pendingBadge: {
    backgroundColor: Colors.warning + "20",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  pendingBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.warning,
  },
  pendingCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  pendingInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  pendingAvatar: {
    width: 45,
    height: 45,
    borderRadius: 22.5,
    backgroundColor: Colors.primary + "20",
    justifyContent: "center",
    alignItems: "center",
  },
  pendingAvatarText: {
    fontSize: 18,
    fontWeight: "600",
    color: Colors.primary,
  },
  pendingDetails: {
    flex: 1,
  },
  pendingPatientName: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.text,
    marginBottom: 2,
  },
  pendingPatientEmail: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 2,
  },
  pendingDate: {
    fontSize: 11,
    color: Colors.textTertiary,
  },
  cancelButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  cancelButtonText: {
    fontSize: 12,
    color: Colors.error,
    fontWeight: "500",
  },
  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: Colors.primary + "10",
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  stepsCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
  },
  stepsTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.text,
    marginBottom: 16,
  },
  stepItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.primary + "20",
    justifyContent: "center",
    alignItems: "center",
  },
  stepNumberText: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.primary,
  },
  stepText: {
    flex: 1,
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
});
