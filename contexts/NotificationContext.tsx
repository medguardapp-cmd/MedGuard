// contexts/NotificationContext.tsx
import React, {
    createContext,
    useContext,
    useEffect,
    useRef,
    useState,
} from "react";
import { AppState, Platform } from "react-native";
import { useAuth } from "../hooks/useAuth";
import {
    registerForPushNotificationsAsync,
    savePushTokenToFirestore,
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

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  addNotification: (
    notification: Omit<Notification, "id" | "timestamp" | "read">,
  ) => void;
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
  if (!context) {
    throw new Error(
      "useNotifications must be used within NotificationProvider",
    );
  }
  return context;
};

// ✅ UNIQUE ID GENERATOR
const generateId = () =>
  `${Date.now()}_${Math.random().toString(36).slice(2)}_${Platform.OS}`;

// ✅ Notification types allowed per role

const CAREGIVER_ALLOWED_TYPES = ["patient-missed", "caregiver-request"];

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user, userRole } = useAuth(); // 👈 pull userRole from auth

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showInApp, setShowInApp] = useState(true);
  const [appState, setAppState] = useState(AppState.currentState);

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
        if (token) {
          savePushTokenToFirestore(user.uid, token);
        }
      });
    }
  }, [user]);

  // ----------------------------
  // APP STATE LISTENER
  // ----------------------------
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      setAppState(nextState);
    });
    return () => subscription.remove();
  }, []);

  // ----------------------------
  // ADD NOTIFICATION
  // ----------------------------
  const addNotification = (
    notification: Omit<Notification, "id" | "timestamp" | "read">,
  ) => {
    // 🚫 Caregivers only receive patient-related notifications

    if (userRole === "caregiver") {
      const notifType = notification.data?.type;

      if (!CAREGIVER_ALLOWED_TYPES.includes(notifType)) return;
    }

    // 🔥 Dedupe key (prevents duplicates from loops/services)
    const dedupeKey = `${notification.title}_${notification.message}`;
    if (dedupeRef.current.has(dedupeKey)) return;

    dedupeRef.current.add(dedupeKey);
    setTimeout(() => {
      dedupeRef.current.delete(dedupeKey);
    }, 10000);

    const newNotification: Notification = {
      ...notification,
      id: generateId(),
      timestamp: new Date(),
      read: false,
    };

    setNotifications((prev) => [newNotification, ...prev]);
  };

  // ----------------------------
  // MARK AS READ
  // ----------------------------
  const markAsRead = (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
  };

  const markAllAsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const clearNotifications = () => {
    setNotifications([]);
    dedupeRef.current.clear();
  };

  // ----------------------------
  // PROVIDER
  // ----------------------------
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
