// contexts/NotificationContext.tsx
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
  sendLocalNotification, // ✅ Add back
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

const CAREGIVER_ALLOWED_TYPES = ["patient-missed", "caregiver-request"];

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user, userRole } = useAuth();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showInApp, setShowInApp] = useState(true);
  const appStateRef = useRef(AppState.currentState);

  const hasRegistered = useRef(false);
  const dedupeRef = useRef<Set<string>>(new Set());

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

      // 🔥 Deduplicate
      const dedupeKey = `${notification.title}_${notification.message}`;
      if (dedupeRef.current.has(dedupeKey)) return;
      dedupeRef.current.add(dedupeKey);
      setTimeout(() => dedupeRef.current.delete(dedupeKey), 10_000);

      // ✅ Add to in-app list
      const newNotification: Notification = {
        ...notification,
        id: generateId(),
        timestamp: new Date(),
        read: false,
      };
      setNotifications((prev) => [newNotification, ...prev]);

      // ✅ Check background state ONCE
      const isBackground =
        appStateRef.current === "background" ||
        appStateRef.current === "inactive";

      // ✅ Push notification (if enabled and backgrounded)
      if (sendPush && isBackground) {
        sendLocalNotification(
          notification.title,
          notification.message,
          notification.data,
          channelId,
        );
      }

      // ✅ Email notification (if backgrounded)
      if (user?.uid && isBackground) {
        const type = notification.data?.type;

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
      }
    },
    [userRole, user?.uid],
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
          type: incoming.request.content.data?.type ?? "info",
          data: incoming.request.content.data,
          sendPush: false,
        });
      },
      (_response) => {
        // User tapped the notification
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
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};
