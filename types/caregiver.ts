// types/caregiver.ts
export type ConnectionStatus = "pending" | "approved" | "rejected";

export interface CaregiverPermissions {
  canManageReminders: boolean; // Create/edit/delete reminders
  canMarkAsTaken: boolean; // Mark medications as taken
  canManageHealth: boolean; // View/edit health records & notes
}

export interface CaregiverConnection {
  id: string;
  patientId: string;
  caregiverId: string;
  patientName: string;
  caregiverName: string;
  caregiverEmail: string;
  patientEmail: string;
  status: ConnectionStatus;
  permissions: CaregiverPermissions; // Store individual toggles
  connectedAt: any;
  approvedAt?: any;
  rejectedAt?: any;
  lastActiveAt?: any;
  notes?: string;
}

// Helper to get permission label for display
export const getPermissionLabel = (
  permissions: CaregiverPermissions,
): string => {
  const labels = [];
  if (permissions.canManageReminders) labels.push("Reminders");
  if (permissions.canMarkAsTaken) labels.push("Adherence");
  if (permissions.canManageHealth) labels.push("Health");

  if (labels.length === 0) return "View Only";
  if (labels.length === 3) return "Full Access";
  return labels.join(" + ");
};

// Check if permissions allow a specific action
export const hasPermission = (
  permissions: CaregiverPermissions | undefined,
  action: keyof CaregiverPermissions,
): boolean => {
  return permissions?.[action] ?? false;
};
