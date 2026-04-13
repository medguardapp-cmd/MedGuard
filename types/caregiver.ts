// types/caregiver.ts
export type ConnectionStatus = "pending" | "approved" | "rejected";
export type PermissionLevel = "view_only" | "reminders_only" | "full_access";

export interface CaregiverPermission {
  canViewMedications: boolean;
  canViewAdherence: boolean;
  canViewHealthRecords: boolean;
  canReceiveAlerts: boolean;
  canManageReminders: boolean;
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
  permissions: PermissionLevel;
  customPermissions?: CaregiverPermission;
  connectedAt: any;
  approvedAt?: any;
  rejectedAt?: any;
  lastActiveAt?: any;
  notes?: string;
}

export interface CaregiverActivity {
  id: string;
  connectionId: string;
  caregiverId: string;
  patientId: string;
  action: "view_medications" | "view_adherence" | "mark_taken" | "add_note";
  timestamp: any;
  details?: any;
}

export interface CaregiverRequest {
  id: string;
  patientId: string;
  caregiverId: string;
  patientName: string;
  caregiverName: string;
  caregiverEmail: string;
  patientEmail: string;
  status: "pending";
  requestedAt: any;
  expiresAt?: any;
}
