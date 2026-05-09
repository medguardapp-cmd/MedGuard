// services/emailService.ts
import { getFunctions, httpsCallable } from "firebase/functions";

const functions = getFunctions();
const sendEmailNotification = httpsCallable(functions, "sendEmailNotification");
const sendEmailWithCaregiver = httpsCallable(
  functions,
  "sendEmailNotificationWithCaregiver",
);

const call = async (
  fn: ReturnType<typeof httpsCallable>,
  payload: Record<string, any>,
): Promise<boolean> => {
  try {
    await fn(payload);
    return true;
  } catch (error) {
    console.error("Email notification error:", error);
    return false;
  }
};

export const emailNotifications = {
  // ── Patient events → also notify caregiver ──
  sendMissedDose: (
    userId: string,
    medicationName: string,
    dosage: string,
    scheduledTime: string,
  ) =>
    call(sendEmailWithCaregiver, {
      userId,
      type: "missed",
      medicationName,
      dosage,
      scheduledTime,
    }),

  sendConsecutiveMissed: (
    userId: string,
    medicationName: string,
    days: number,
  ) =>
    call(sendEmailWithCaregiver, {
      userId,
      type: "consecutive-missed",
      medicationName,
      days,
    }),

  sendSideEffect: (userId: string, medicationName: string, effect: string) =>
    call(sendEmailWithCaregiver, {
      userId,
      type: "side-effect",
      medicationName,
      effect,
    }),

  sendDrugInteraction: (
    userId: string,
    med1: string,
    med2: string,
    description: string,
  ) =>
    call(sendEmailWithCaregiver, {
      userId,
      type: "drug-interaction",
      drug1: med1,
      drug2: med2,
      description,
    }),

  // ── Caregiver-targeted events → single recipient only ──
  sendCaregiverRequest: (userId: string, caregiverName: string) =>
    call(sendEmailNotification, {
      userId,
      type: "caregiver-request",
      caregiverName,
    }),

  sendPatientAccepted: (caregiverId: string, patientName: string) =>
    call(sendEmailNotification, {
      userId: caregiverId,
      type: "patient-accepted",
      patientName,
    }),

  sendPatientMissed: (
    patientId: string,
    patientName: string,
    medicationName: string,
    dosage: string,
    time: string,
  ) =>
    call(sendEmailWithCaregiver, {
      userId: patientId,
      type: "missed",
      medicationName,
      dosage,
      scheduledTime: time,
    }),
};
