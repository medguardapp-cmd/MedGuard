// hooks/useCaregiverPermissions.ts
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "../lib/firebase";
import { CaregiverPermissions } from "../types/caregiver";

interface UseCaregiverPermissionsProps {
  patientId: string;
  caregiverId: string;
}

export const useCaregiverPermissions = ({
  patientId,
  caregiverId,
}: UseCaregiverPermissionsProps) => {
  const [permissions, setPermissions] = useState<CaregiverPermissions | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);

  useEffect(() => {
    if (!patientId || !caregiverId) {
      setLoading(false);
      return;
    }

    // ✅ Use real-time listener instead of one-time fetch
    const connectionsRef = collection(db, "caregiver_connections");
    const q = query(
      connectionsRef,
      where("patientId", "==", patientId),
      where("caregiverId", "==", caregiverId),
      where("status", "==", "approved"),
    );

    // Set up real-time listener
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        if (!snapshot.empty) {
          const connection = snapshot.docs[0].data();
          const perms = connection.permissions as CaregiverPermissions;

          console.log("✅ Permissions loaded:", perms); // Debug log

          setPermissions(perms);
          setHasAccess(true);
        } else {
          console.log("❌ No connection found");
          setPermissions(null);
          setHasAccess(false);
        }
        setLoading(false);
      },
      (error) => {
        console.error("Error fetching permissions:", error);
        setPermissions(null);
        setHasAccess(false);
        setLoading(false);
      },
    );

    // Cleanup subscription
    return () => unsubscribe();
  }, [patientId, caregiverId]);

  const can = {
    addMedications: () => permissions?.canManageReminders ?? false,
    editMedications: () => permissions?.canManageReminders ?? false,
    deleteMedications: () => permissions?.canManageReminders ?? false,
    manageReminders: () => permissions?.canManageReminders ?? false,
    markAsTaken: () => {
      const result = permissions?.canMarkAsTaken ?? false;
      console.log("🔍 markAsTaken check:", { permissions, result }); // Debug log
      return result;
    },
    manageHealth: () => permissions?.canManageHealth ?? false,
  };

  return { permissions, loading, hasAccess, can };
};
