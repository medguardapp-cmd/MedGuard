// components/InAppNotification.tsx
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import {
    Animated,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from "react-native";

interface NotificationProps {
  id: string;
  title: string;
  message: string;
  type: "info" | "success" | "warning" | "error";
  onPress?: () => void;
  onDismiss?: (id: string) => void;
}

interface InAppNotificationProps {
  notifications: NotificationProps[];
  onDismiss: (id: string) => void;
  duration?: number;
}

export const InAppNotification: React.FC<InAppNotificationProps> = ({
  notifications,
  onDismiss,
  duration = 4000,
}) => {
  const [currentNotification, setCurrentNotification] =
    useState<NotificationProps | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(-100)).current;
  const timeoutRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    if (notifications.length > 0 && !currentNotification) {
      showNotification(notifications[0]);
    }
  }, [notifications]);

  const showNotification = (notification: NotificationProps) => {
    setCurrentNotification(notification);

    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    timeoutRef.current = setTimeout(() => {
      hideNotification();
    }, duration);
  };

  const hideNotification = () => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: -100,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => {
      if (currentNotification) {
        onDismiss(currentNotification.id);
      }
      setCurrentNotification(null);
    });
  };

  const getIconName = (type: string) => {
    switch (type) {
      case "success":
        return "checkmark-circle";
      case "warning":
        return "warning";
      case "error":
        return "alert-circle";
      default:
        return "information-circle";
    }
  };

  const getColors = (type: string) => {
    switch (type) {
      case "success":
        return {
          bg: "#dcfce7",
          border: "#22c55e",
          icon: "#22c55e",
          text: "#166534",
        };
      case "warning":
        return {
          bg: "#fef3c7",
          border: "#f59e0b",
          icon: "#f59e0b",
          text: "#92400e",
        };
      case "error":
        return {
          bg: "#fee2e2",
          border: "#ef4444",
          icon: "#ef4444",
          text: "#991b1b",
        };
      default:
        return {
          bg: "#dbeafe",
          border: "#3b82f6",
          icon: "#3b82f6",
          text: "#1e40af",
        };
    }
  };

  if (!currentNotification) return null;

  const colors = getColors(currentNotification.type);

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }],
          backgroundColor: colors.bg,
          borderLeftColor: colors.border,
        },
      ]}
    >
      <TouchableOpacity
        style={styles.content}
        onPress={() => {
          currentNotification.onPress?.();
          hideNotification();
        }}
        activeOpacity={0.9}
      >
        <Ionicons
          name={getIconName(currentNotification.type)}
          size={24}
          color={colors.icon}
        />
        <View style={styles.textContainer}>
          <Text style={[styles.title, { color: colors.text }]}>
            {currentNotification.title}
          </Text>
          <Text style={[styles.message, { color: colors.text }]}>
            {currentNotification.message}
          </Text>
        </View>
        <TouchableOpacity onPress={hideNotification} style={styles.closeButton}>
          <Ionicons name="close" size={20} color={colors.text} />
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 60,
    left: 16,
    right: 16,
    borderRadius: 12,
    borderLeftWidth: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5,
    zIndex: 1000,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 12,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 2,
  },
  message: {
    fontSize: 14,
  },
  closeButton: {
    padding: 4,
  },
});
