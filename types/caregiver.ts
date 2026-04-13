// types/caregiver.ts
export type ConnectionStatus = "pending" | "approved" | "rejected";
export type PermissionPreset =
  | "view_only"
  | "reminder_assistant"
  | "adherence_helper"
  | "health_assistant"
  | "full_access";

export interface CaregiverPermissions {
  canViewMedications: boolean;
  canAddMedications: boolean;
  canEditMedications: boolean;
  canDeleteMedications: boolean;
  canMarkAsTaken: boolean;
  canViewLogs: boolean;
  canExportLogs: boolean;
  canViewReminders: boolean;
  canCreateReminders: boolean;
  canEditReminders: boolean;
  canDeleteReminders: boolean;
  canViewHealthRecords: boolean;
  canEditHealthRecords: boolean;
  canViewNotes: boolean;
  canAddNotes: boolean;
  canReceiveAlerts: boolean;
  canReceiveReports: boolean;
  canViewEmergencyInfo: boolean;
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
  permissionPreset: PermissionPreset;
  customPermissions?: CaregiverPermissions;
  connectedAt: any;
  approvedAt?: any;
  rejectedAt?: any;
  lastActiveAt?: any;
  notes?: string;
}

// Permission Presets
export const PERMISSION_PRESETS: Record<
  PermissionPreset,
  CaregiverPermissions
> = {
  view_only: {
    canViewMedications: true,
    canAddMedications: false,
    canEditMedications: false,
    canDeleteMedications: false,
    canMarkAsTaken: false,
    canViewLogs: true,
    canExportLogs: false,
    canViewReminders: true,
    canCreateReminders: false,
    canEditReminders: false,
    canDeleteReminders: false,
    canViewHealthRecords: true,
    canEditHealthRecords: false,
    canViewNotes: true,
    canAddNotes: false,
    canReceiveAlerts: false,
    canReceiveReports: false,
    canViewEmergencyInfo: true,
  },
  reminder_assistant: {
    canViewMedications: true,
    canAddMedications: false,
    canEditMedications: false,
    canDeleteMedications: false,
    canMarkAsTaken: false,
    canViewLogs: true,
    canExportLogs: false,
    canViewReminders: true,
    canCreateReminders: true,
    canEditReminders: true,
    canDeleteReminders: true,
    canViewHealthRecords: false,
    canEditHealthRecords: false,
    canViewNotes: false,
    canAddNotes: false,
    canReceiveAlerts: true,
    canReceiveReports: false,
    canViewEmergencyInfo: false,
  },
  adherence_helper: {
    canViewMedications: true,
    canAddMedications: false,
    canEditMedications: false,
    canDeleteMedications: false,
    canMarkAsTaken: true,
    canViewLogs: true,
    canExportLogs: true,
    canViewReminders: true,
    canCreateReminders: false,
    canEditReminders: false,
    canDeleteReminders: false,
    canViewHealthRecords: false,
    canEditHealthRecords: false,
    canViewNotes: false,
    canAddNotes: false,
    canReceiveAlerts: true,
    canReceiveReports: true,
    canViewEmergencyInfo: false,
  },
  health_assistant: {
    canViewMedications: true,
    canAddMedications: false,
    canEditMedications: false,
    canDeleteMedications: false,
    canMarkAsTaken: false,
    canViewLogs: true,
    canExportLogs: false,
    canViewReminders: false,
    canCreateReminders: false,
    canEditReminders: false,
    canDeleteReminders: false,
    canViewHealthRecords: true,
    canEditHealthRecords: true,
    canViewNotes: true,
    canAddNotes: true,
    canReceiveAlerts: false,
    canReceiveReports: false,
    canViewEmergencyInfo: true,
  },
  full_access: {
    canViewMedications: true,
    canAddMedications: true,
    canEditMedications: true,
    canDeleteMedications: true,
    canMarkAsTaken: true,
    canViewLogs: true,
    canExportLogs: true,
    canViewReminders: true,
    canCreateReminders: true,
    canEditReminders: true,
    canDeleteReminders: true,
    canViewHealthRecords: true,
    canEditHealthRecords: true,
    canViewNotes: true,
    canAddNotes: true,
    canReceiveAlerts: true,
    canReceiveReports: true,
    canViewEmergencyInfo: true,
  },
};

export const getPresetInfo = (preset: PermissionPreset) => {
  const presets = {
    view_only: {
      name: "View Only",
      icon: "👁️",
      description: "Can see medications and logs, cannot make changes",
      color: "#64748b",
    },
    reminder_assistant: {
      name: "Reminder Assistant",
      icon: "⏰",
      description: "Can create and manage reminders",
      color: "#3b82f6",
    },
    adherence_helper: {
      name: "Adherence Helper",
      icon: "✅",
      description: "Can mark medications as taken, track adherence",
      color: "#10b981",
    },
    health_assistant: {
      name: "Health Assistant",
      icon: "📋",
      description: "Can manage health records and add notes",
      color: "#8b5cf6",
    },
    full_access: {
      name: "Full Access",
      icon: "🔓",
      description: "Complete control over all features",
      color: "#ef4444",
    },
  };
  return presets[preset];
};
