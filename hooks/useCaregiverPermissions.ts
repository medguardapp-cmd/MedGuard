// hooks/useCaregiverPermissions.ts
import { useEffect, useState } from "react";
import { db } from "../lib/firebase";
import {
    CaregiverPermissions,
    PERMISSION_PRESETS,
    PermissionPreset,
} from "../types/caregiver";

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
        // Query the connection
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
          const preset = connection.permissionPreset as PermissionPreset;
          const perms = PERMISSION_PRESETS[preset];
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

  // Helper functions for checking specific permissions
  const can = {
    viewMedications: () => permissions?.canViewMedications ?? false,
    addMedications: () => permissions?.canAddMedications ?? false,
    editMedications: () => permissions?.canEditMedications ?? false,
    deleteMedications: () => permissions?.canDeleteMedications ?? false,
    markAsTaken: () => permissions?.canMarkAsTaken ?? false,
    viewLogs: () => permissions?.canViewLogs ?? false,
    exportLogs: () => permissions?.canExportLogs ?? false,
    viewReminders: () => permissions?.canViewReminders ?? false,
    createReminders: () => permissions?.canCreateReminders ?? false,
    editReminders: () => permissions?.canEditReminders ?? false,
    deleteReminders: () => permissions?.canDeleteReminders ?? false,
    viewHealthRecords: () => permissions?.canViewHealthRecords ?? false,
    editHealthRecords: () => permissions?.canEditHealthRecords ?? false,
    viewNotes: () => permissions?.canViewNotes ?? false,
    addNotes: () => permissions?.canAddNotes ?? false,
    receiveAlerts: () => permissions?.canReceiveAlerts ?? false,
    receiveReports: () => permissions?.canReceiveReports ?? false,
    viewEmergencyInfo: () => permissions?.canViewEmergencyInfo ?? false,
  };

  return { permissions, loading, hasAccess, can };
};
