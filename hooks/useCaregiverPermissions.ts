// hooks/useCaregiverPermissions.ts
import { collection, getDocs, query, where } from "firebase/firestore";
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
    const fetchPermissions = async () => {
      if (!patientId || !caregiverId) {
        setLoading(false);
        return;
      }

      try {
        const connectionsRef = collection(db, "caregiver_connections");
        const q = query(
          connectionsRef,
          where("patientId", "==", patientId),
          where("caregiverId", "==", caregiverId),
          where("status", "==", "approved"),
        );

        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
          const connection = snapshot.docs[0].data();
          const perms = connection.permissions as CaregiverPermissions;
          setPermissions(perms);
          setHasAccess(true);
        } else {
          setPermissions(null);
          setHasAccess(false);
        }
      } catch (error) {
        console.error("Error fetching permissions:", error);
        setPermissions(null);
        setHasAccess(false);
      } finally {
        setLoading(false);
      }
    };

    fetchPermissions();
  }, [patientId, caregiverId]);

  // ✅ FIXED: Map to your 3 actual permission fields
  const can = {
    // All medication management uses canManageReminders
    addMedications: () => permissions?.canManageReminders ?? false,
    editMedications: () => permissions?.canManageReminders ?? false,
    deleteMedications: () => permissions?.canManageReminders ?? false,

    // Reminders
    manageReminders: () => permissions?.canManageReminders ?? false,

    // Adherence
    markAsTaken: () => permissions?.canMarkAsTaken ?? false,

    // Health Records
    manageHealth: () => permissions?.canManageHealth ?? false,
  };

  return { permissions, loading, hasAccess, can };
};
