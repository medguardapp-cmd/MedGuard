// contexts/NotificationContext.tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState, Platform } from "react-native";
import { useAuth } from "../hooks/useAuth";
import {
  addNotificationListener,
  registerForPushNotificationsAsync,
  savePushTokenToFirestore,
  sendLocalNotification,
} from "../lib/notifications";
import { emailNotifications } from "../services/emailService";

interface Notification {
  id: string;
  title: string;
  message: string;
  type: "info" | "success" | "warning" | "error";
  data?: any;
  timestamp: Date;
  read: boolean;
}

interface NotificationInput extends Omit<
  Notification,
  "id" | "timestamp" | "read"
> {
  sendPush?: boolean;
  channelId?: string;
}

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  addNotification: (notification: NotificationInput) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearNotifications: () => void;
  showInApp: boolean;
  setShowInApp: (show: boolean) => void;
  navigateFromNotification: (data: any) => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(
  undefined,
);

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context)
    throw new Error(
      "useNotifications must be used within NotificationProvider",
    );
  return context;
};

const generateId = () =>
  `${Date.now()}_${Math.random().toString(36).slice(2)}_${Platform.OS}`;

const CAREGIVER_ALLOWED_TYPES = [
  "patient-missed",
  "caregiver-request",
  "severe-interaction",
  "mild-interaction",
];

const navigateFromNotification = (data: any) => {
  if (!data?.type) return;

  switch (data.type) {
    case "missed":
    case "late":
    case "consecutive-missed":
      router.push("/(tabs)/medication-logs");
      break;
    case "severe-interaction":
    case "mild-interaction":
      router.push({
        pathname: "/(tabs)/MedicationsScreen",
        params: { tab: "reactions" },
      });
      break;
    case "caregiver-request":
    case "patient-missed":
      router.push("/(tabs)/MoreScreen");
      break;
    case "side-effect":
      router.push("/(tabs)/MedicationsScreen");
      break;
    default:
      router.push("/(tabs)/notifications");
      break;
  }
};

// Helper function to send caregiver emails (outside component to avoid hooks issues)
const sendCaregiverEmails = async (
  userId: string,
  type: string,
  data: any,
  userRole: string,
  caregiverNotificationTypes: string[],
) => {
  // Only proceed for patients and relevant notification types
  if (userRole !== "patient" || !caregiverNotificationTypes.includes(type)) {
    return;
  }

  try {
    // Dynamic imports to avoid circular dependencies
    const { getDocs, query, collection, where } =
      await import("firebase/firestore");
    const { db } = await import("../lib/firebase");

    // Query caregiver_connections for this patient
    const connectionsSnap = await getDocs(
      query(
        collection(db, "caregiver_connections"),
        where("patientId", "==", userId),
        where("status", "==", "approved"),
      ),
    );

    // Send email to all connected caregivers
    for (const connDoc of connectionsSnap.docs) {
      const connection = connDoc.data();
      const caregiverEmail = connection.caregiverEmail;

      if (!caregiverEmail) continue;

      // Send the appropriate email based on notification type
      switch (type) {
        case "missed":
          if (data?.medicationName && data?.dosage && data?.scheduledTime) {
            emailNotifications.sendMissedDose(
              connection.caregiverId,
              data.medicationName,
              data.dosage,
              data.scheduledTime,
            );
          }
          break;

        case "consecutive-missed":
          if (data?.medicationName && data?.days) {
            emailNotifications.sendConsecutiveMissed(
              connection.caregiverId,
              data.medicationName,
              data.days,
            );
          }
          break;

        case "severe-interaction":
        case "mild-interaction":
          emailNotifications.sendDrugInteraction(
            connection.caregiverId,
            data?.drug1 || "Unknown",
            data?.drug2 || "Unknown",
            data?.description || "",
          );
          break;

        case "side-effect":
          if (data?.medicationName && data?.effect) {
            emailNotifications.sendSideEffect(
              connection.caregiverId,
              data.medicationName,
              data.effect,
            );
          }
          break;
      }
    }
  } catch (error) {
    console.error("Error sending caregiver email notifications:", error);
  }
};

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user, userRole } = useAuth();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showInApp, setShowInApp] = useState(true);
  const appStateRef = useRef(AppState.currentState);
  const appStartTimeRef = useRef(Date.now());

  const hasRegistered = useRef(false);
  const hasLoaded = useRef(false);
  const dedupeRef = useRef<Set<string>>(new Set());

  // ----------------------------
  // LOAD FROM STORAGE
  // ----------------------------
  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem("notifications"),
      AsyncStorage.getItem("notif_dedupe"),
    ]).then(([notifRaw, dedupeRaw]) => {
      if (dedupeRaw) {
        dedupeRef.current = new Set(JSON.parse(dedupeRaw));
      }
      if (notifRaw) {
        const parsed = JSON.parse(notifRaw);
        setNotifications(
          parsed.map((n: any) => ({ ...n, timestamp: new Date(n.timestamp) })),
        );
      }
      hasLoaded.current = true;
    });
  }, []);

  // ----------------------------
  // PERSIST TO STORAGE
  // ----------------------------
  useEffect(() => {
    if (!hasLoaded.current) return;
    AsyncStorage.setItem("notifications", JSON.stringify(notifications));
  }, [notifications]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  // ----------------------------
  // PUSH NOTIFICATION REGISTRATION
  // ----------------------------
  useEffect(() => {
    if (user && !hasRegistered.current) {
      hasRegistered.current = true;
      registerForPushNotificationsAsync().then((token) => {
        if (token) savePushTokenToFirestore(user.uid, token);
      });
    }
  }, [user]);

  // ----------------------------
  // APP STATE LISTENER
  // ----------------------------
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      appStateRef.current = next;
    });
    return () => sub.remove();
  }, []);

  // ----------------------------
  // ADD NOTIFICATION
  // ----------------------------
  const addNotification = useCallback(
    ({ sendPush = false, channelId, ...notification }: NotificationInput) => {
      // 🚫 Caregiver role filter
      if (userRole === "caregiver") {
        const notifType = notification.data?.type;
        if (!CAREGIVER_ALLOWED_TYPES.includes(notifType)) return;
      }

      // Skip missed/late notifications for first 30 seconds after app start
      const isMissedOrLate =
        notification.data?.type === "missed" ||
        notification.data?.type === "late";

      if (isMissedOrLate) {
        const secondsSinceStart = (Date.now() - appStartTimeRef.current) / 1000;
        if (secondsSinceStart < 30) {
          console.log(
            "⏭️ Skipping missed/late notification - app just started",
          );
          return;
        }
      }

      // 🔥 Deduplicate
      const today = new Date().toDateString();
      const dedupeKey = notification.data?.reminderId
        ? `${notification.data.type}_${notification.data.reminderId}_${today}`
        : `${notification.title}_${notification.message}_${today}`;
      if (dedupeRef.current.has(dedupeKey)) return;
      dedupeRef.current.add(dedupeKey);
      AsyncStorage.setItem(
        "notif_dedupe",
        JSON.stringify([...dedupeRef.current]),
      );

      // Always add to in-app list
      const newNotification: Notification = {
        ...notification,
        id: generateId(),
        timestamp: new Date(),
        read: false,
      };
      setNotifications((prev) => [newNotification, ...prev]);

      // Push: send when app is backgrounded AND sendPush is true
      const isBackground =
        appStateRef.current === "background" ||
        appStateRef.current === "inactive";

      if (sendPush && isBackground) {
        sendLocalNotification(
          notification.title,
          notification.message,
          notification.data,
          channelId,
        );
      }

      // Email notifications (backgrounded only)
      if (user?.uid && isBackground) {
        const type = notification.data?.type;

        // 1. Send email to patient
        switch (type) {
          case "missed":
            if (
              notification.data?.medicationName &&
              notification.data?.dosage &&
              notification.data?.scheduledTime
            ) {
              emailNotifications.sendMissedDose(
                user.uid,
                notification.data.medicationName,
                notification.data.dosage,
                notification.data.scheduledTime,
              );
            }
            break;

          case "consecutive-missed":
            if (notification.data?.medicationName && notification.data?.days) {
              emailNotifications.sendConsecutiveMissed(
                user.uid,
                notification.data.medicationName,
                notification.data.days,
              );
            }
            break;

          case "severe-interaction":
          case "mild-interaction":
            emailNotifications.sendDrugInteraction(
              user.uid,
              notification.data?.drug1 || "Unknown",
              notification.data?.drug2 || "Unknown",
              notification.data?.description || "",
            );
            break;

          case "caregiver-request":
            if (notification.data?.caregiverName) {
              emailNotifications.sendCaregiverRequest(
                user.uid,
                notification.data.caregiverName,
              );
            }
            break;

          case "patient-accepted":
            if (notification.data?.patientName) {
              emailNotifications.sendPatientAccepted(
                user.uid,
                notification.data.patientName,
              );
            }
            break;

          case "patient-missed":
            if (
              notification.data?.patientName &&
              notification.data?.medicationName
            ) {
              emailNotifications.sendPatientMissed(
                user.uid,
                notification.data.patientName,
                notification.data.medicationName,
                notification.data?.dosage || "",
                notification.data?.scheduledTime || "",
              );
            }
            break;

          case "side-effect":
            if (
              notification.data?.medicationName &&
              notification.data?.effect
            ) {
              emailNotifications.sendSideEffect(
                user.uid,
                notification.data.medicationName,
                notification.data.effect,
              );
            }
            break;
        }

        // 2. Send email to all connected caregivers
        const caregiverNotificationTypes = [
          "missed",
          "consecutive-missed",
          "severe-interaction",
          "mild-interaction",
          "side-effect",
        ];

        // Call the async function without await (fire and forget)
        sendCaregiverEmails(
          user.uid,
          type,
          notification.data,
          userRole,
          caregiverNotificationTypes,
        );
      }
    },
    [user, userRole], // Added proper dependencies
  );

  // ----------------------------
  // LISTEN FOR INCOMING PUSH NOTIFICATIONS
  // ----------------------------
  useEffect(() => {
    const unsubscribe = addNotificationListener(
      (incoming) => {
        addNotification({
          title: incoming.request.content.title ?? "Notification",
          message: incoming.request.content.body ?? "",
          type: (["info", "success", "warning", "error"].includes(
            incoming.request.content.data?.type as string,
          )
            ? incoming.request.content.data?.type
            : "info") as Notification["type"],
          data: incoming.request.content.data,
          sendPush: false,
        });
      },
      (response) => {
        // User tapped the notification — navigate to the right screen
        const data = response.notification.request.content.data;
        navigateFromNotification(data);
      },
    );
    return unsubscribe;
  }, [addNotification]);

  // ----------------------------
  // MARK AS READ / CLEAR
  // ----------------------------
  const markAsRead = (id: string) =>
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );

  const markAllAsRead = () =>
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));

  const clearNotifications = () => {
    setNotifications([]);
    dedupeRef.current.clear();
    AsyncStorage.removeItem("notifications");
    AsyncStorage.removeItem("notif_dedupe");
  };

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        addNotification,
        markAsRead,
        markAllAsRead,
        clearNotifications,
        showInApp,
        setShowInApp,
        navigateFromNotification,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};
