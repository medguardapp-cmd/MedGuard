// app/caregiver.tsx
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
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
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Colors from "../constants/colors";
import { useOnboarding } from "../contexts/OnboardingContext";
import { auth, db } from "../lib/firebase";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
type ConnectionStatus = "pending" | "approved" | "rejected";

interface CaregiverConnection {
  id: string;
  patientId: string;
  caregiverId: string;
  patientName: string;
  caregiverName: string;
  caregiverEmail: string;
  patientEmail: string;
  connectedAt: any;
  status: ConnectionStatus;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () =>
    chars.charAt(Math.floor(Math.random() * chars.length)),
  ).join("");
}

function formatDate(timestamp: any): string {
  if (!timestamp?.toDate) return "Recently";
  return timestamp.toDate().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────
export default function CaregiverScreen() {
  const router = useRouter();
  const { data } = useOnboarding();
  const userType = data.userData.userType; // "patient" | "caregiver"

  const [myCode, setMyCode] = useState<string | null>(null);
  const [loadingCode, setLoadingCode] = useState(true);

  const [pendingRequests, setPendingRequests] = useState<CaregiverConnection[]>(
    [],
  );
  const [approvedConnections, setApprovedConnections] = useState<
    CaregiverConnection[]
  >([]);
  const [sentRequests, setSentRequests] = useState<CaregiverConnection[]>([]);
  const [loadingConnections, setLoadingConnections] = useState(true);

  const [inputCode, setInputCode] = useState("");
  const [connectingCode, setConnectingCode] = useState(false);

  const userId = auth.currentUser?.uid;
  const userEmail = auth.currentUser?.email ?? "";
  const userName = data.userData.name ?? "Unknown";

  // ─── Load / generate patient code ────────────
  useEffect(() => {
    if (!userId) return;
    const loadCode = async () => {
      setLoadingCode(true);
      const userDoc = await getDoc(doc(db, "users", userId));
      if (userDoc.exists() && userDoc.data()?.caregiverCode) {
        setMyCode(userDoc.data()!.caregiverCode);
      } else {
        const newCode = generateCode();
        await updateDoc(doc(db, "users", userId), { caregiverCode: newCode });
        setMyCode(newCode);
      }
      setLoadingCode(false);
    };
    if (userType === "patient") loadCode();
    else setLoadingCode(false);
  }, [userId, userType]);

  // ─── Listen to connections ────────────────────
  useEffect(() => {
    if (!userId) return;

    if (userType === "patient") {
      const q = query(
        collection(db, "caregiver_connections"),
        where("patientId", "==", userId),
      );
      const unsub = onSnapshot(q, (snap) => {
        const all = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as CaregiverConnection[];
        setPendingRequests(all.filter((c) => c.status === "pending"));
        setApprovedConnections(all.filter((c) => c.status === "approved"));
        setLoadingConnections(false);
      });
      return unsub;
    } else {
      const q = query(
        collection(db, "caregiver_connections"),
        where("caregiverId", "==", userId),
      );
      const unsub = onSnapshot(q, (snap) => {
        const all = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as CaregiverConnection[];
        setSentRequests(all.filter((c) => c.status === "pending"));
        setApprovedConnections(all.filter((c) => c.status === "approved"));
        setLoadingConnections(false);
      });
      return unsub;
    }
  }, [userId, userType]);

  // ─── Regenerate code ──────────────────────────
  const handleRegenerateCode = () => {
    Alert.alert(
      "Regenerate Code?",
      "Your current caregivers will lose access. You'll need to share the new code with them again.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Regenerate",
          style: "destructive",
          onPress: async () => {
            if (!userId) return;
            const newCode = generateCode();
            await updateDoc(doc(db, "users", userId), {
              caregiverCode: newCode,
            });
            setMyCode(newCode);
          },
        },
      ],
    );
  };

  const handleShareCode = async () => {
    if (!myCode) return;
    await Share.share({
      message: `Use this code to connect with me on MedGuard: ${myCode}`,
    });
  };

  // ─── Caregiver: send request ──────────────────
  const handleConnect = async () => {
    const code = inputCode.trim().toUpperCase();
    if (code.length !== 6) {
      Alert.alert("Invalid Code", "Please enter a valid 6-character code.");
      return;
    }
    if (!userId) return;
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
      if (patientId === userId) {
        Alert.alert("Invalid", "You cannot connect to yourself.");
        setConnectingCode(false);
        return;
      }
      const existingSnap = await getDocs(
        query(
          collection(db, "caregiver_connections"),
          where("patientId", "==", patientId),
          where("caregiverId", "==", userId),
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
        } else {
          // Rejected — allow re-request
          await updateDoc(
            doc(db, "caregiver_connections", existingSnap.docs[0].id),
            {
              status: "pending",
              connectedAt: serverTimestamp(),
            },
          );
          setInputCode("");
          Alert.alert(
            "Request Sent!",
            `Your request has been sent to ${patientData.name ?? "the patient"}.`,
          );
        }
        setConnectingCode(false);
        return;
      }
      await addDoc(collection(db, "caregiver_connections"), {
        patientId,
        caregiverId: userId,
        patientName: patientData.name ?? "Unknown Patient",
        patientEmail: patientData.email ?? "",
        caregiverName: userName,
        caregiverEmail: userEmail,
        connectedAt: serverTimestamp(),
        status: "pending",
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

  // ─── Patient: approve ─────────────────────────
  const handleApprove = async (connection: CaregiverConnection) => {
    await updateDoc(doc(db, "caregiver_connections", connection.id), {
      status: "approved",
    });
  };

  // ─── Patient: reject ──────────────────────────
  const handleReject = (connection: CaregiverConnection) => {
    Alert.alert(
      "Reject Request?",
      `Deny ${connection.caregiverName}'s request to connect?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reject",
          style: "destructive",
          onPress: async () => {
            await updateDoc(doc(db, "caregiver_connections", connection.id), {
              status: "rejected",
            });
          },
        },
      ],
    );
  };

  // ─── Disconnect ───────────────────────────────
  const handleDisconnect = (connection: CaregiverConnection) => {
    const otherName =
      userType === "patient"
        ? connection.caregiverName
        : connection.patientName;
    Alert.alert("Disconnect", `Remove ${otherName} from your connections?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Disconnect",
        style: "destructive",
        onPress: async () => {
          await deleteDoc(doc(db, "caregiver_connections", connection.id));
        },
      },
    ]);
  };

  // ─── Caregiver: cancel pending request ────────
  const handleCancelRequest = (connection: CaregiverConnection) => {
    Alert.alert(
      "Cancel Request?",
      `Cancel your request to ${connection.patientName}?`,
      [
        { text: "No", style: "cancel" },
        {
          text: "Cancel Request",
          style: "destructive",
          onPress: async () => {
            await deleteDoc(doc(db, "caregiver_connections", connection.id));
          },
        },
      ],
    );
  };

  // ─── Card renderer ────────────────────────────
  const renderCard = (
    conn: CaregiverConnection,
    variant: "approve-reject" | "disconnect" | "cancel",
  ) => {
    const name = userType === "patient" ? conn.caregiverName : conn.patientName;
    const email =
      userType === "patient" ? conn.caregiverEmail : conn.patientEmail;
    const initial = name?.charAt(0)?.toUpperCase() ?? "?";
    const dateLabel =
      variant === "approve-reject"
        ? `Requested ${formatDate(conn.connectedAt)}`
        : variant === "cancel"
          ? `Sent ${formatDate(conn.connectedAt)}`
          : `Connected ${formatDate(conn.connectedAt)}`;

    return (
      <View key={conn.id} style={styles.connectionCard}>
        <View style={styles.connectionAvatar}>
          <Text style={styles.connectionAvatarText}>{initial}</Text>
        </View>
        <View style={styles.connectionInfo}>
          <Text style={styles.connectionName}>{name}</Text>
          <Text style={styles.connectionEmail}>{email}</Text>
          <Text style={styles.connectionDate}>{dateLabel}</Text>
        </View>

        {variant === "approve-reject" && (
          <View style={styles.approvalButtons}>
            <TouchableOpacity
              style={styles.approveButton}
              onPress={() => handleApprove(conn)}
            >
              <Ionicons name="checkmark" size={14} color={Colors.surface} />
              <Text style={styles.approveButtonText}>Approve</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.rejectButton}
              onPress={() => handleReject(conn)}
            >
              <Ionicons name="close" size={14} color={Colors.error} />
              <Text style={styles.rejectButtonText}>Reject</Text>
            </TouchableOpacity>
          </View>
        )}

        {variant === "disconnect" && (
          <TouchableOpacity
            style={styles.disconnectButton}
            onPress={() => handleDisconnect(conn)}
          >
            <Ionicons
              name="close-circle-outline"
              size={22}
              color={Colors.error}
            />
          </TouchableOpacity>
        )}

        {variant === "cancel" && (
          <View style={styles.pendingWrap}>
            <View style={styles.pendingBadge}>
              <Text style={styles.pendingBadgeText}>Pending</Text>
            </View>
            <TouchableOpacity onPress={() => handleCancelRequest(conn)}>
              <Ionicons
                name="close-circle-outline"
                size={20}
                color={Colors.textTertiary}
              />
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color={Colors.surface} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Caregiver</Text>
        <Text style={styles.headerSubtitle}>
          {userType === "patient"
            ? "Share your code with a caregiver to give them access"
            : "Enter a patient's code to send a connection request"}
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── PATIENT: Code card ── */}
        {userType === "patient" && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="key-outline" size={22} color={Colors.primary} />
              <Text style={styles.cardTitle}>Your Caregiver Code</Text>
            </View>
            <Text style={styles.cardSubtitle}>
              Share this code with someone you trust. They'll send you a request
              which you can approve or reject.
            </Text>
            {loadingCode ? (
              <ActivityIndicator
                color={Colors.primary}
                style={{ marginVertical: 24 }}
              />
            ) : (
              <>
                <View style={styles.codeBox}>
                  <Text style={styles.codeText}>{myCode}</Text>
                </View>
                <View style={styles.codeActions}>
                  <TouchableOpacity
                    style={styles.shareButton}
                    onPress={handleShareCode}
                  >
                    <Ionicons
                      name="share-social-outline"
                      size={18}
                      color={Colors.surface}
                    />
                    <Text style={styles.shareButtonText}>Share Code</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.regenButton}
                    onPress={handleRegenerateCode}
                  >
                    <Ionicons
                      name="refresh-outline"
                      size={18}
                      color={Colors.error}
                    />
                    <Text style={styles.regenButtonText}>Regenerate</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        )}

        {/* ── PATIENT: Pending requests ── */}
        {userType === "patient" && (
          <View style={styles.section}>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionTitle}>Pending Requests</Text>
              {pendingRequests.length > 0 && (
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>
                    {pendingRequests.length}
                  </Text>
                </View>
              )}
            </View>
            {loadingConnections ? (
              <View style={styles.emptyCard}>
                <ActivityIndicator color={Colors.primary} />
              </View>
            ) : pendingRequests.length === 0 ? (
              <View style={styles.emptyCard}>
                <Ionicons
                  name="mail-outline"
                  size={36}
                  color={Colors.textTertiary}
                />
                <Text style={styles.emptyTitle}>No pending requests</Text>
                <Text style={styles.emptySubtitle}>
                  When a caregiver sends you a request, it will appear here.
                </Text>
              </View>
            ) : (
              pendingRequests.map((conn) => renderCard(conn, "approve-reject"))
            )}
          </View>
        )}

        {/* ── CAREGIVER: Enter code ── */}
        {userType === "caregiver" && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons
                name="person-add-outline"
                size={22}
                color={Colors.primary}
              />
              <Text style={styles.cardTitle}>Connect to a Patient</Text>
            </View>
            <Text style={styles.cardSubtitle}>
              Ask the patient for their 6-character code. They will receive a
              request to approve before you are connected.
            </Text>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.codeInput}
                value={inputCode}
                onChangeText={(t) => setInputCode(t.toUpperCase())}
                placeholder="e.g. AB3X7K"
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
                  <Text style={styles.connectButtonText}>Send Request</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── CAREGIVER: Pending sent requests ── */}
        {userType === "caregiver" && sentRequests.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Pending Requests</Text>
            {sentRequests.map((conn) => renderCard(conn, "cancel"))}
          </View>
        )}

        {/* ── Both: Approved connections ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {userType === "patient" ? "My Caregivers" : "My Patients"}
          </Text>
          {loadingConnections ? (
            <View style={styles.emptyCard}>
              <ActivityIndicator color={Colors.primary} />
            </View>
          ) : approvedConnections.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons
                name={
                  userType === "patient" ? "people-outline" : "medkit-outline"
                }
                size={48}
                color={Colors.textTertiary}
              />
              <Text style={styles.emptyTitle}>
                {userType === "patient"
                  ? "No caregivers yet"
                  : "No patients yet"}
              </Text>
              <Text style={styles.emptySubtitle}>
                {userType === "patient"
                  ? "Approve a request above to add a caregiver"
                  : "Send a request using a patient's code above"}
              </Text>
            </View>
          ) : (
            approvedConnections.map((conn) => renderCard(conn, "disconnect"))
          )}
        </View>

        {/* Info box */}
        <View style={styles.infoBox}>
          <Ionicons
            name="information-circle-outline"
            size={18}
            color={Colors.primary}
          />
          <Text style={styles.infoText}>
            {userType === "patient"
              ? "Caregivers can view your medication schedule and adherence history. You control who has access."
              : "You can view the patient's medication schedule and track adherence once they approve your request."}
          </Text>
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
  },
  backButton: { marginBottom: 12, alignSelf: "flex-start" },
  headerTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: Colors.surface,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: "rgba(255,255,255,0.75)",
    lineHeight: 20,
  },
  scroll: { flex: 1 },
  scrollContent: { paddingTop: 16 },

  card: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  cardTitle: { fontSize: 17, fontWeight: "700", color: Colors.text },
  cardSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 19,
    marginBottom: 20,
  },

  codeBox: {
    backgroundColor: Colors.primary + "10",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.primary + "30",
    borderStyle: "dashed",
    paddingVertical: 20,
    alignItems: "center",
    marginBottom: 16,
  },
  codeText: {
    fontSize: 36,
    fontWeight: "800",
    color: Colors.primary,
    letterSpacing: 8,
  },
  codeActions: { flexDirection: "row", gap: 12 },
  shareButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    borderRadius: 12,
  },
  shareButtonText: { color: Colors.surface, fontWeight: "600", fontSize: 15 },
  regenButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.error + "40",
    backgroundColor: Colors.error + "08",
  },
  regenButtonText: { color: Colors.error, fontWeight: "600", fontSize: 15 },

  inputRow: { flexDirection: "row", gap: 10 },
  codeInput: {
    flex: 1,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 22,
    fontWeight: "700",
    color: Colors.text,
    letterSpacing: 4,
    textAlign: "center",
  },
  connectButton: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 14,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    minWidth: 110,
  },
  connectButtonDisabled: { backgroundColor: Colors.primary + "50" },
  connectButtonText: { color: Colors.surface, fontWeight: "700", fontSize: 13 },

  section: { marginHorizontal: 16, marginBottom: 16 },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.text,
    marginBottom: 12,
  },
  countBadge: {
    backgroundColor: Colors.warning,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginBottom: 12,
  },
  countBadgeText: { fontSize: 12, color: Colors.surface, fontWeight: "700" },

  emptyCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 32,
    alignItems: "center",
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.textSecondary,
    marginTop: 8,
  },
  emptySubtitle: {
    fontSize: 13,
    color: Colors.textTertiary,
    textAlign: "center",
    lineHeight: 19,
  },

  connectionCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  connectionAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: Colors.primary + "15",
    justifyContent: "center",
    alignItems: "center",
  },
  connectionAvatarText: {
    fontSize: 19,
    fontWeight: "700",
    color: Colors.primary,
  },
  connectionInfo: { flex: 1 },
  connectionName: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.text,
    marginBottom: 2,
  },
  connectionEmail: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 2,
  },
  connectionDate: { fontSize: 11, color: Colors.textTertiary },

  approvalButtons: { flexDirection: "column", gap: 6 },
  approveButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.success,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  approveButtonText: { color: Colors.surface, fontWeight: "600", fontSize: 12 },
  rejectButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.error + "12",
    borderWidth: 1,
    borderColor: Colors.error + "30",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  rejectButtonText: { color: Colors.error, fontWeight: "600", fontSize: 12 },

  disconnectButton: { padding: 4 },

  pendingWrap: { alignItems: "center", gap: 4 },
  pendingBadge: {
    backgroundColor: Colors.warning + "20",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: Colors.warning + "40",
  },
  pendingBadgeText: { fontSize: 11, color: Colors.warning, fontWeight: "600" },

  infoBox: {
    marginHorizontal: 16,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: Colors.primary + "08",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.primary + "20",
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
});
