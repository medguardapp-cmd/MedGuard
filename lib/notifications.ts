// lib/notifications.ts
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { AppState, Platform } from "react-native";

Notifications.setNotificationHandler({
  handleNotification: async () => {
    const isForeground = AppState.currentState === "active";
    return {
      shouldShowBanner: !isForeground, // ← was always true
      shouldShowList: true,
      shouldPlaySound: !isForeground, // ← no duplicate sound either
      shouldSetBadge: true,
    };
  },
});

// Request permissions and get Expo push token
export async function registerForPushNotificationsAsync() {
  let token;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("medications", {
      name: "Medication Reminders",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF231F7C",
      sound: "default",
    });
    await Notifications.setNotificationChannelAsync("interactions", {
      name: "Drug Interactions",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF231F7C",
      sound: "default",
    });
    await Notifications.setNotificationChannelAsync("general", {
      name: "General",
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: "default",
    });
    await Notifications.setNotificationChannelAsync("medication-alarms", {
      name: "Medication Alarms",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF231F7C",
      sound: "default",
      bypassDnd: true, // Bypass Do Not Disturb for alarms
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }

  if (Device.isDevice) {
    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      console.log("Failed to get push token for push notification!");
      return null;
    }

    try {
      const projectId =
        Constants.expoConfig?.extra?.eas?.projectId ??
        Constants.easConfig?.projectId;
      if (!projectId) {
        console.log("No project ID found");
        return null;
      }
      token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      console.log("Push token:", token);
    } catch (error) {
      console.error("Error getting push token:", error);
    }
  } else {
    console.log("Must use physical device for Push Notifications");
  }

  return token;
}

// Save push token to Firestore
export async function savePushTokenToFirestore(userId: string, token: string) {
  const { doc, setDoc } = await import("firebase/firestore");
  const { db } = await import("./firebase");

  const userRef = doc(db, "users", userId);
  await setDoc(
    userRef,
    {
      pushToken: token,
      pushTokenUpdatedAt: new Date(),
    },
    { merge: true },
  );
}

// Send local notification
export async function sendLocalNotification(
  title: string,
  body: string,
  data?: any,
  channelId?: string,
) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: data || {},
      sound: "default",
      priority: Notifications.AndroidNotificationPriority.HIGH,
      // ❌ Remove channelId from here
    },
    trigger: {
      channelId: channelId || "general", // ✅ channelId goes here in trigger
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, // ✅ Use the enum
      seconds: 1, // Show after 1 second
    },
  });
}

// Schedule a reminder notification
export async function scheduleReminderNotification(
  id: string,
  title: string,
  body: string,
  date: Date,
  data?: any,
) {
  // Cancel any existing notification with same ID
  await Notifications.cancelScheduledNotificationAsync(id);

  // Schedule new notification
  await Notifications.scheduleNotificationAsync({
    identifier: id,
    content: {
      title,
      body,
      data: { ...data, reminderId: id },
      sound: "default",
      priority: Notifications.AndroidNotificationPriority.HIGH,
    },
    trigger: {
      date: date,
      channelId: "medications",
    },
  });
}

// Schedule daily recurring reminder
export async function scheduleDailyReminder(
  id: string,
  title: string,
  body: string,
  hour: number,
  minute: number,
  days?: number[], // 0-6, where 0 is Sunday
) {
  // Cancel existing
  await Notifications.cancelScheduledNotificationAsync(id);

  const trigger: any = {
    hour,
    minute,
    repeats: true,
  };

  if (days && days.length > 0) {
    trigger.weekday = days.map((d) => d + 1); // Convert to 1-7 format
  }

  await Notifications.scheduleNotificationAsync({
    identifier: id,
    content: {
      title,
      body,
      sound: "default",
      priority: Notifications.AndroidNotificationPriority.HIGH,
    },
    trigger,
  });
}

// Cancel a scheduled notification
export async function cancelNotification(identifier: string) {
  await Notifications.cancelScheduledNotificationAsync(identifier);
}

// Get all scheduled notifications
export async function getAllScheduledNotifications() {
  return await Notifications.getAllScheduledNotificationsAsync();
}

// Add notification listener
export function addNotificationListener(
  onReceive: (notification: Notifications.Notification) => void,
  onResponse: (response: Notifications.NotificationResponse) => void,
) {
  const receiveSubscription =
    Notifications.addNotificationReceivedListener(onReceive);
  const responseSubscription =
    Notifications.addNotificationResponseReceivedListener(onResponse);

  return () => {
    receiveSubscription.remove();
    responseSubscription.remove();
  };
}
