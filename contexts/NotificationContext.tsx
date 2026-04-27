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
  sendLocalNotification,
} from "../lib/notifications";

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
  sendPush?: boolean; // ✅ NEW: opt-in per-notification
  channelId?: string; // ✅ NEW: forward to OS channel
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

const TYPE_TO_ICON: Record<string, string> = {
  info: "ℹ️",
  success: "✅",
  warning: "⚠️",
  error: "❌",
};

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user, userRole } = useAuth();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showInApp, setShowInApp] = useState(true);
  const appStateRef = useRef(AppState.currentState); // ✅ use ref so addNotification closure stays fresh

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
  // APP STATE LISTENER  (keep ref in sync)
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

      // 🔥 Deduplicate (title + message, 10 s window)
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

      // ✅ Only fire OS push when app is backgrounded (or inactive)
      //    AND the caller opted in via sendPush
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
    },
    [userRole],
  );

  // ----------------------------
  // ✅ LISTEN FOR INCOMING PUSH NOTIFICATIONS
  //    (keeps in-app list in sync when a push arrives from the server)
  // ----------------------------
  useEffect(() => {
    const unsubscribe = addNotificationListener(
      (incoming) => {
        // Received while app is open — add to in-app list without re-triggering a push
        addNotification({
          title: incoming.request.content.title ?? "Notification",
          message: incoming.request.content.body ?? "",
          type: incoming.request.content.data?.type ?? "info",
          data: incoming.request.content.data,
          sendPush: false, // already came from OS — don't re-fire
        });
      },
      (_response) => {
        // User tapped the notification — navigate or handle here if needed
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
