// lib/caregiverService.ts
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
import {
    CaregiverActivity,
    CaregiverConnection,
    PermissionLevel,
} from "../types/caregiver";
import { db } from "./firebase";

// Send connection request
export const sendConnectionRequest = async (
  caregiverId: string,
  patientCode: string,
  caregiverName: string,
  caregiverEmail: string,
) => {
  try {
    // Find patient by code
    const usersRef = collection(db, "users");
    const q = query(usersRef, where("caregiverCode", "==", patientCode));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      throw new Error("Invalid patient code");
    }

    const patientDoc = querySnapshot.docs[0];
    const patientId = patientDoc.id;
    const patientData = patientDoc.data();

    // Check if connection already exists
    const existingQuery = query(
      collection(db, "caregiver_connections"),
      where("patientId", "==", patientId),
      where("caregiverId", "==", caregiverId),
    );
    const existing = await getDocs(existingQuery);

    if (!existing.empty) {
      const existingConnection = existing.docs[0].data();
      if (existingConnection.status === "pending") {
        throw new Error("Request already pending");
      } else if (existingConnection.status === "approved") {
        throw new Error("Already connected to this patient");
      }
    }

    // Create connection request
    const connection = {
      patientId,
      caregiverId,
      patientName: patientData.name || "Unknown Patient",
      patientEmail: patientData.email,
      caregiverName,
      caregiverEmail,
      status: "pending",
      permissions: "view_only" as PermissionLevel,
      connectedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    };

    const docRef = await addDoc(
      collection(db, "caregiver_connections"),
      connection,
    );
    return { success: true, connectionId: docRef.id };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

// Get pending requests for patient
export const getPendingRequests = (
  patientId: string,
  callback: (requests: CaregiverConnection[]) => void,
) => {
  const q = query(
    collection(db, "caregiver_connections"),
    where("patientId", "==", patientId),
    where("status", "==", "pending"),
  );
  return onSnapshot(q, (snapshot) => {
    const requests = snapshot.docs.map(
      (doc) => ({ id: doc.id, ...doc.data() }) as CaregiverConnection,
    );
    callback(requests);
  });
};

// Get approved connections
export const getApprovedConnections = (
  userId: string,
  userType: "patient" | "caregiver",
  callback: (connections: CaregiverConnection[]) => void,
) => {
  const field = userType === "patient" ? "patientId" : "caregiverId";
  const q = query(
    collection(db, "caregiver_connections"),
    where(field, "==", userId),
    where("status", "==", "approved"),
  );
  return onSnapshot(q, (snapshot) => {
    const connections = snapshot.docs.map(
      (doc) => ({ id: doc.id, ...doc.data() }) as CaregiverConnection,
    );
    callback(connections);
  });
};

// Approve connection request
export const approveRequest = async (
  connectionId: string,
  permissions?: PermissionLevel,
) => {
  const connectionRef = doc(db, "caregiver_connections", connectionId);
  await updateDoc(connectionRef, {
    status: "approved",
    approvedAt: serverTimestamp(),
    permissions: permissions || "view_only",
  });
};

// Reject connection request
export const rejectRequest = async (connectionId: string) => {
  const connectionRef = doc(db, "caregiver_connections", connectionId);
  await updateDoc(connectionRef, {
    status: "rejected",
    rejectedAt: serverTimestamp(),
  });
};

// Update caregiver permissions
export const updatePermissions = async (
  connectionId: string,
  permissions: PermissionLevel,
) => {
  const connectionRef = doc(db, "caregiver_connections", connectionId);
  await updateDoc(connectionRef, {
    permissions,
    permissionsUpdatedAt: serverTimestamp(),
  });
};

// Remove connection
export const removeConnection = async (connectionId: string) => {
  const connectionRef = doc(db, "caregiver_connections", connectionId);
  await deleteDoc(connectionRef);
};

// Log caregiver activity
export const logCaregiverActivity = async (
  connectionId: string,
  caregiverId: string,
  patientId: string,
  action: CaregiverActivity["action"],
  details?: any,
) => {
  await addDoc(collection(db, "caregiver_activities"), {
    connectionId,
    caregiverId,
    patientId,
    action,
    details,
    timestamp: serverTimestamp(),
  });
};

// Check if caregiver has permission
export const hasPermission = async (
  caregiverId: string,
  patientId: string,
  requiredPermission: keyof CaregiverPermission,
): Promise<boolean> => {
  const q = query(
    collection(db, "caregiver_connections"),
    where("caregiverId", "==", caregiverId),
    where("patientId", "==", patientId),
    where("status", "==", "approved"),
  );

  const snapshot = await getDocs(q);
  if (snapshot.empty) return false;

  const connection = snapshot.docs[0].data();
  const permissionLevel = connection.permissions;

  switch (permissionLevel) {
    case "full_access":
      return true;
    case "reminders_only":
      return (
        requiredPermission === "canReceiveAlerts" ||
        requiredPermission === "canViewAdherence"
      );
    case "view_only":
      return (
        requiredPermission === "canViewMedications" ||
        requiredPermission === "canViewAdherence"
      );
    default:
      return false;
  }
};
