import axios from "axios";
import * as admin from "firebase-admin";
import { defineString } from "firebase-functions/params";
import {
  CallableRequest,
  HttpsError,
  onCall,
  onRequest,
} from "firebase-functions/v2/https";
import * as nodemailer from "nodemailer";

admin.initializeApp();

// ─── Gmail Config via environment params ─────────────────────────────────────
const GMAIL_USER = defineString("GMAIL_USER");
const GMAIL_PASS = defineString("GMAIL_PASS");
const FB_PAGE_ACCESS_TOKEN = defineString("FB_PAGE_ACCESS_TOKEN");
const FB_VERIFY_TOKEN = defineString("FB_VERIFY_TOKEN");

function getTransporter() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: GMAIL_USER.value(),
      pass: GMAIL_PASS.value(),
    },
  });
}

const APP_NAME = "MedGuard";

// ─── Get user email from Firestore ───────────────────────────────────────────
async function getUserEmail(userId: string): Promise<string | null> {
  const snap = await admin.firestore().collection("users").doc(userId).get();
  return snap.exists ? (snap.data()?.email ?? null) : null;
}

// ─── Send email helper ────────────────────────────────────────────────────────
async function sendEmail(to: string, subject: string, html: string) {
  const from = `"${APP_NAME}" <${GMAIL_USER.value()}>`;
  await getTransporter().sendMail({ from, to, subject, html });
}

// ─── Email Templates ──────────────────────────────────────────────────────────
const SEVERE_REGEX =
  /severe|serious|fatal|life-threatening|major|contraindicated|avoid|dangerous|hemorrhage|bleeding/i;

const footer = (note = APP_NAME) => `<hr/><small>${note}</small>`;

type TemplateMap = {
  [key: string]: (p: any) => { subject: string; html: string };
};

const templates: TemplateMap = {
  missed: ({ medicationName, dosage, scheduledTime }) => ({
    subject: `⚠️ Missed Dose: ${medicationName}`,
    html: `
      <h2>Missed Dose Alert</h2>
      <p>You missed your scheduled dose of <strong>${medicationName} (${dosage})</strong>
      that was due at <strong>${scheduledTime}</strong>.</p>
      <p>Please take it as soon as possible or consult your doctor if unsure.</p>
      ${footer(`You received this because you have background email alerts enabled in ${APP_NAME}.`)}
    `,
  }),

  "consecutive-missed": ({ medicationName, days }) => ({
    subject: `🚨 Low Adherence: ${medicationName} missed ${days} days`,
    html: `
      <h2>Medication Adherence Alert</h2>
      <p>You have missed <strong>${medicationName}</strong> for
      <strong>${days} consecutive day${days > 1 ? "s" : ""}</strong>.</p>
      <p>Consistent medication intake is important for your health.
      Please contact your doctor if you are experiencing difficulties.</p>
      ${footer(`${APP_NAME} — medication adherence tracker`)}
    `,
  }),

  "drug-interaction": ({ drug1, drug2, description }) => {
    const isSevere = SEVERE_REGEX.test(description ?? "");
    return {
      subject: isSevere
        ? `🚨 Severe Drug Interaction Detected`
        : `⚠️ Drug Interaction Notice`,
      html: `
        <h2>${isSevere ? "Severe" : "Mild"} Drug Interaction Detected</h2>
        <p><strong>${drug1}</strong> may interact ${isSevere ? "<strong>severely</strong>" : ""}
        with <strong>${drug2}</strong>.</p>
        ${description ? `<p><em>${description}</em></p>` : ""}
        <p>${
          isSevere
            ? "⚠️ Please consult your doctor or pharmacist <strong>immediately</strong>."
            : "Monitor for any unusual side effects and inform your doctor."
        }</p>
        ${footer(`${APP_NAME} — always consult a healthcare professional for medical advice`)}
      `,
    };
  },

  "caregiver-request": ({ caregiverName }) => ({
    subject: `👤 Caregiver Request from ${caregiverName}`,
    html: `
      <h2>New Caregiver Request</h2>
      <p><strong>${caregiverName}</strong> has requested to connect with you as your caregiver in ${APP_NAME}.</p>
      <p>Open the app to accept or decline this request.</p>
      ${footer()}
    `,
  }),

  "patient-accepted": ({ patientName }) => ({
    subject: `✅ ${patientName} accepted your caregiver request`,
    html: `
      <h2>Caregiver Request Accepted</h2>
      <p><strong>${patientName}</strong> has accepted your caregiver request in ${APP_NAME}.</p>
      <p>You can now monitor their medication schedule in the app.</p>
      ${footer()}
    `,
  }),

  "patient-missed": ({
    patientName,
    medicationName,
    dosage,
    scheduledTime,
  }) => ({
    subject: `⚠️ Your patient ${patientName} missed a dose`,
    html: `
      <h2>Patient Missed Dose Alert</h2>
      <p>Your patient <strong>${patientName}</strong> missed their scheduled dose of
      <strong>${medicationName} (${dosage})</strong> at <strong>${scheduledTime}</strong>.</p>
      <p>You may want to follow up with them directly.</p>
      ${footer(`${APP_NAME} — caregiver alert`)}
    `,
  }),

  "side-effect": ({ medicationName, effect }) => ({
    subject: `🩺 Side Effect Reported: ${medicationName}`,
    html: `
      <h2>Side Effect Report</h2>
      <p>You reported experiencing <strong>${effect}</strong> as a possible side effect of
      <strong>${medicationName}</strong>.</p>
      <p>Please consult your doctor if symptoms persist or worsen.</p>
      ${footer()}
    `,
  }),
};

// ─── Request payload type ─────────────────────────────────────────────────────
interface NotificationPayload {
  userId: string;
  type: string;
  [key: string]: any;
}

// ─── Main Callable Function ───────────────────────────────────────────────────
export const sendEmailNotification = onCall(
  async (request: CallableRequest<NotificationPayload>) => {
    const { userId, type, ...payload } = request.data;

    if (!userId || !type) {
      throw new HttpsError("invalid-argument", "userId and type are required.");
    }

    const email = await getUserEmail(userId);
    if (!email) {
      throw new HttpsError("not-found", `No email found for user ${userId}.`);
    }

    const template = templates[type];
    if (!template) {
      throw new HttpsError(
        "invalid-argument",
        `Unknown notification type: ${type}.`,
      );
    }

    const { subject, html } = template(payload);

    try {
      await sendEmail(email, subject, html);
      return { success: true };
    } catch (err) {
      console.error("Email send error:", err);
      throw new HttpsError("internal", "Failed to send email.");
    }
  },
);

// ─── Firestore Helpers for Messenger Bot ─────────────────────────────────────

async function getUserByPsid(psid: string) {
  const snapshot = await admin
    .firestore()
    .collection("users")
    .where("fb_psid", "==", psid)
    .where("fb_linked", "==", true)
    .limit(1)
    .get();

  if (snapshot.empty) return null;
  return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
}

async function getRealReminders(psid: string) {
  const user = await getUserByPsid(psid);
  if (!user) {
    return {
      text: "⚠️ Your account is not linked yet.\n\nType: *link your@email.com* to connect.",
    };
  }

  const remindersRef = admin
    .firestore()
    .collection("users")
    .doc(user.id)
    .collection("reminders");

  const snapshot = await remindersRef.where("enabled", "==", true).get();

  if (snapshot.empty) {
    return { text: "📋 You don't have any reminders set up yet." };
  }

  // Get today's date in PHT (UTC+8)
  const now = new Date();
  const phtOffset = 8 * 60 * 60 * 1000;
  const phtNow = new Date(now.getTime() + phtOffset);
  const todayStr = phtNow.toISOString().split("T")[0]; // "YYYY-MM-DD"

  // Helper: format "HH:mm" → "12:00 AM/PM"
  function formatTime(time: string): string {
    const [hourStr, minuteStr] = time.split(":");
    let hour = parseInt(hourStr, 10);
    const minute = minuteStr;
    const period = hour >= 12 ? "PM" : "AM";
    if (hour === 0) hour = 12;
    else if (hour > 12) hour -= 12;
    return `${hour}:${minute} ${period}`;
  }

  let todayReminders = "";

  snapshot.forEach((doc) => {
    const r = doc.data();

    // Check if scheduledDate matches today
    const scheduledDate = r.scheduledDate
      ? r.scheduledDate.substring(0, 10) // "YYYY-MM-DD"
      : null;

    if (scheduledDate !== todayStr) return;

    const name = r.medicationName || "Unknown";
    const dosage = r.medicationDosage || "";
    const times: string[] = r.times || [];
    const days: string[] = r.days || [];

    todayReminders += `⏰ ${name}`;
    if (dosage) todayReminders += ` — ${dosage}`;
    todayReminders += "\n";

    if (times.length > 0) {
      const formatted = times.map(formatTime).join(", ");
      todayReminders += `   Time(s): ${formatted}\n`;
    }
    if (days.length > 0) todayReminders += `   Days: ${days.join(", ")}\n`;
    todayReminders += "\n";
  });

  if (!todayReminders) {
    return { text: "📋 You have no reminders scheduled for today." };
  }

  return { text: `📋 *Today's Reminders:*\n\n${todayReminders}` };
}

async function getRealMedications(psid: string) {
  const user = await getUserByPsid(psid);

  if (!user) {
    return {
      text: "⚠️ Your account is not linked yet.\n\nType: *link your@email.com* to connect.",
    };
  }

  const medsRef = admin
    .firestore()
    .collection("users")
    .doc(user.id)
    .collection("medications");
  const medsSnapshot = await medsRef.get();

  if (medsSnapshot.empty) {
    return { text: "💊 You don't have any medications set up yet." };
  }

  let medText = "💊 *Your Medications:*\n\n";
  medsSnapshot.forEach((doc) => {
    const med = doc.data();
    const medName = med.name || med.generic_name || med.brand_name || "Unknown";
    const dosage =
      med.dosageAmount && med.dosageUnit
        ? `${med.dosageAmount}${med.dosageUnit}`
        : med.dosage || "";
    const frequency = med.frequency || med.schedule || "";

    medText += `• ${medName}\n`;
    if (dosage) medText += `  Dosage: ${dosage}\n`;
    if (frequency) medText += `  Frequency: ${frequency}\n`;
    if (med.is_combination) medText += `  Type: Combination Drug\n`;
    if (med.quantity) medText += `  Remaining: ${med.quantity}\n`;
    medText += "\n";
  });

  return { text: medText };
}

// ─── Facebook Messenger Bot ─────────────────────────────────────────────────
export const fbMessengerBot = onRequest(async (req, res) => {
  const VERIFY_TOKEN = FB_VERIFY_TOKEN.value();
  const PAGE_ACCESS_TOKEN = FB_PAGE_ACCESS_TOKEN.value();

  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("Webhook verified!");
      res.status(200).send(challenge);
      return;
    }
    res.sendStatus(403);
    return;
  }

  if (req.method === "POST") {
    const body = req.body;

    if (body.object === "page") {
      for (const entry of body.entry) {
        const webhookEvent = entry.messaging[0];
        const senderPsid = webhookEvent.sender.id;

        if (webhookEvent.message) {
          await handleMessage(
            senderPsid,
            webhookEvent.message,
            PAGE_ACCESS_TOKEN,
          );
        } else if (webhookEvent.postback) {
          await handlePostback(
            senderPsid,
            webhookEvent.postback,
            PAGE_ACCESS_TOKEN,
          );
        }
      }
      res.status(200).send("EVENT_RECEIVED");
      return;
    }
    res.sendStatus(404);
    return;
  }

  res.sendStatus(405);
});

async function handlePostback(
  senderPsid: string,
  postback: any,
  pageToken: string,
) {
  if (postback.payload === "GET_STARTED") {
    const response = {
      text: "👋 Welcome to MedGuard! I'm your medication assistant.\n\nHere's what I can do:\n\n• Type *link your@email.com* - Connect your account\n• Type *help* - See all commands\n• Type *reminders* - View your reminders\n• Type *meds* - List your medications\n\nTo get personalized alerts, link your account first!",
    };
    await callSendAPI(senderPsid, response, pageToken);
  }
}

async function handleMessage(
  senderPsid: string,
  message: any,
  pageToken: string,
) {
  let response: any;

  if (message.text) {
    const userText = message.text.toLowerCase().trim();

    // Link by email
    if (userText.startsWith("link ")) {
      const email = userText.replace("link ", "").trim().toLowerCase();
      if (email && email.includes("@")) {
        try {
          const userSnapshot = await admin
            .firestore()
            .collection("users")
            .where("email", "==", email)
            .limit(1)
            .get();

          if (userSnapshot.empty) {
            response = {
              text: "❌ No account found with that email. Make sure you use the same email as your MedGuard app.",
            };
          } else {
            const userDoc = userSnapshot.docs[0];
            await userDoc.ref.update({
              fb_psid: senderPsid,
              fb_linked: true,
              fb_linked_at: admin.firestore.FieldValue.serverTimestamp(),
            });
            response = {
              text: "✅ Account linked successfully!\n\nType *reminders* or *meds* to see your info!",
            };
          }
        } catch (error) {
          console.error("Link error:", error);
          response = {
            text: "❌ Could not link account. Please try again later.",
          };
        }
      } else {
        response = {
          text: "Please type: link your@email.com\n\nUse the same email you used in the MedGuard app.",
        };
      }
    }
    // Get real reminders from Firestore
    else if (userText === "reminders") {
      response = await getRealReminders(senderPsid);
    }
    // Get real medications from Firestore
    else if (userText === "meds") {
      response = await getRealMedications(senderPsid);
    }
    // Help menu
    else if (userText === "help" || userText === "hi" || userText === "hello") {
      response = {
        text: "👋 Welcome to MedGuard! I'm your medication assistant.\n\nCommands:\n• *link your@email.com* - Connect your account\n• *reminders* - View your reminders\n• *meds* - List your medications\n• *help* - Show this menu",
      };
    } else if (userText === "missed") {
      response = {
        text: "⚠️ Please open the MedGuard app to report a missed dose for accurate tracking.",
      };
    } else {
      response = {
        text: "I didn't quite get that. Type *help* to see what I can do!",
      };
    }
  }

  await callSendAPI(senderPsid, response, pageToken);
}

async function callSendAPI(
  senderPsid: string,
  response: any,
  pageToken: string,
) {
  const requestBody = {
    recipient: { id: senderPsid },
    message: response,
  };

  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/me/messages?access_token=${pageToken}`,
      requestBody,
    );
    console.log("Message sent successfully");
  } catch (error) {
    console.error("Error sending message:", error);
  }
}
