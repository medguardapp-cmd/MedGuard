// services/emailService.ts
import * as MailComposer from "expo-mail-composer";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../lib/firebase";

const getUserEmail = async (userId: string): Promise<string | null> => {
  try {
    const userDoc = await getDoc(doc(db, "users", userId));
    const userData = userDoc.data();
    return userData?.email || null;
  } catch (error) {
    console.error("Error getting user email:", error);
    return null;
  }
};

// Helper to strip HTML tags
const stripHtml = (html: string): string => {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ");
};

const sendEmail = async (
  to: string,
  subject: string,
  html: string,
): Promise<boolean> => {
  try {
    // Check if email is available on device
    const isAvailable = await MailComposer.isAvailableAsync();
    if (!isAvailable) {
      console.warn("Mail composer not available on this device");
      return false;
    }

    const result = await MailComposer.composeAsync({
      recipients: [to],
      subject: subject,
      body: stripHtml(html),
      isHtml: true,
    });

    if (result.status === "sent") {
      console.log("Email sent successfully");
      return true;
    } else if (result.status === "saved" || result.status === "cancelled") {
      console.log("Email was saved as draft or cancelled");
      return false;
    }

    return false;
  } catch (error) {
    console.error("Error opening email composer:", error);
    return false;
  }
};

// Simple email templates (keep HTML minimal)
export const emailNotifications = {
  sendMissedDose: async (
    userId: string,
    medicationName: string,
    dosage: string,
    scheduledTime: string,
  ) => {
    const email = await getUserEmail(userId);
    if (!email) {
      console.log(`No email found for user ${userId}`);
      return false;
    }

    const subject = `⚠️ Missed Dose: ${medicationName}`;
    const html = `
      <b>Missed Medication Dose</b><br><br>
      You missed <b>${medicationName}</b> (${dosage})<br>
      Scheduled for: ${scheduledTime}<br><br>
      Missing doses can affect your treatment effectiveness.
    `;

    return sendEmail(email, subject, html);
  },

  sendConsecutiveMissed: async (
    userId: string,
    medicationName: string,
    days: number,
  ) => {
    const email = await getUserEmail(userId);
    if (!email) {
      console.log(`No email found for user ${userId}`);
      return false;
    }

    const subject = `🚨 ${medicationName} Missed for ${days} Days`;
    const html = `
      <b>Medication Adherence Alert</b><br><br>
      You've missed <b>${medicationName}</b> for <b>${days} consecutive days</b>.<br><br>
      This could significantly impact your treatment.
    `;

    return sendEmail(email, subject, html);
  },

  sendDrugInteraction: async (
    userId: string,
    med1: string,
    med2: string,
    description: string,
  ) => {
    const email = await getUserEmail(userId);
    if (!email) {
      console.log(`No email found for user ${userId}`);
      return false;
    }

    const subject = `⚠️ Drug Interaction: ${med1} & ${med2}`;
    const html = `
      <b>Drug Interaction Detected</b><br><br>
      <b>${med1}</b> may interact with <b>${med2}</b><br>
      ${description || "Please consult your healthcare provider."}
    `;

    return sendEmail(email, subject, html);
  },

  sendCaregiverRequest: async (userId: string, caregiverName: string) => {
    const email = await getUserEmail(userId);
    if (!email) {
      console.log(`No email found for user ${userId}`);
      return false;
    }

    const subject = `👤 ${caregiverName} Wants to Connect`;
    const html = `
      <b>Caregiver Request</b><br><br>
      <b>${caregiverName}</b> wants to connect as your caregiver.<br>
      They can view your medication schedule and receive alerts.
    `;

    return sendEmail(email, subject, html);
  },

  sendPatientAccepted: async (caregiverId: string, patientName: string) => {
    const email = await getUserEmail(caregiverId);
    if (!email) {
      console.log(`No email found for user ${caregiverId}`);
      return false;
    }

    const subject = `✅ ${patientName} Accepted`;
    const html = `
      <b>Connection Accepted</b><br><br>
      <b>${patientName}</b> accepted your caregiver request.<br>
      You'll now receive notifications about their medications.
    `;

    return sendEmail(email, subject, html);
  },

  sendPatientMissed: async (
    caregiverId: string,
    patientName: string,
    medicationName: string,
    dosage: string,
    time: string,
  ) => {
    const email = await getUserEmail(caregiverId);
    if (!email) {
      console.log(`No email found for user ${caregiverId}`);
      return false;
    }

    const subject = `⚠️ ${patientName} Missed ${medicationName}`;
    const html = `
      <b>Patient Missed Dose</b><br><br>
      <b>${patientName}</b> missed <b>${medicationName}</b> (${dosage})<br>
      Scheduled for: ${time}
    `;

    return sendEmail(email, subject, html);
  },

  sendSideEffect: async (
    userId: string,
    medicationName: string,
    effect: string,
  ) => {
    const email = await getUserEmail(userId);
    if (!email) {
      console.log(`No email found for user ${userId}`);
      return false;
    }

    const subject = `🔍 Side Effect: ${medicationName}`;
    const html = `
      <b>Side Effect Reported</b><br><br>
      <b>${medicationName}</b>: ${effect}<br><br>
      Monitor this and consult your healthcare provider if it persists.
    `;

    return sendEmail(email, subject, html);
  },
};
