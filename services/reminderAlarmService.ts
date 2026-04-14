// services/reminderAlarmService.ts
import { Audio } from "expo-av";
import * as Notifications from "expo-notifications";

// Configure notification handler for alarms
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    priority: Notifications.AndroidNotificationPriority.HIGH,
  }),
});

// Sound reference for custom alarm
let alarmSound: Audio.Sound | null = null;

// Load alarm sound
export async function loadAlarmSound() {
  try {
    if (!alarmSound) {
      const { sound } = await Audio.Sound.createAsync(
        require("../../assets/sounds/alarm.mp3"), // You'll need to add this file
        { shouldPlay: false },
      );
      alarmSound = sound;
    }
    return alarmSound;
  } catch (error) {
    console.log("Using default notification sound");
    return null;
  }
}

// Play alarm sound
export async function playAlarmSound() {
  try {
    const sound = await loadAlarmSound();
    if (sound) {
      await sound.setPositionAsync(0);
      await sound.playAsync();
    }
  } catch (error) {
    console.error("Error playing alarm sound:", error);
  }
}

// Stop alarm sound
export async function stopAlarmSound() {
  try {
    if (alarmSound) {
      await alarmSound.stopAsync();
    }
  } catch (error) {
    console.error("Error stopping alarm sound:", error);
  }
}

// Schedule a medication reminder alarm
export async function scheduleMedicationAlarm(
  reminderId: string,
  medicationName: string,
  dosage: string,
  scheduledTime: Date,
  options?: {
    repeat?: boolean;
    intervalMinutes?: number;
    snoozeEnabled?: boolean;
  },
) {
  // Cancel any existing alarm for this reminder
  await Notifications.cancelScheduledNotificationAsync(reminderId);

  const trigger: Notifications.NotificationTriggerInput = options?.repeat
    ? {
        hour: scheduledTime.getHours(),
        minute: scheduledTime.getMinutes(),
        repeats: true,
      }
    : {
        date: scheduledTime,
        channelId: "medication-alarms",
      };

  await Notifications.scheduleNotificationAsync({
    identifier: reminderId,
    content: {
      title: "💊 Medication Reminder",
      body: `Time to take ${medicationName} ${dosage}`,
      sound: "default",
      priority: Notifications.AndroidNotificationPriority.HIGH,
      categoryIdentifier: "medication_action",
      data: {
        reminderId,
        medicationName,
        dosage,
        type: "medication_reminder",
        action: "take",
      },
    },
    trigger,
  });

  console.log(`✅ Scheduled alarm for ${medicationName} at ${scheduledTime}`);
}

// Schedule a snooze alarm (remind again in X minutes)
export async function scheduleSnoozeAlarm(
  reminderId: string,
  medicationName: string,
  dosage: string,
  snoozeMinutes: number = 10,
) {
  const snoozeTime = new Date();
  snoozeTime.setMinutes(snoozeTime.getMinutes() + snoozeMinutes);

  await Notifications.scheduleNotificationAsync({
    identifier: `${reminderId}_snooze`,
    content: {
      title: "🔔 Snooze Reminder",
      body: `Don't forget to take ${medicationName} ${dosage}`,
      sound: "default",
      priority: Notifications.AndroidNotificationPriority.HIGH,
      data: {
        reminderId,
        medicationName,
        dosage,
        type: "medication_reminder",
        action: "snooze",
        isSnooze: true,
      },
    },
    trigger: {
      date: snoozeTime,
      channelId: "medication-alarms",
    },
  });
}

// Cancel a scheduled alarm
export async function cancelMedicationAlarm(reminderId: string) {
  await Notifications.cancelScheduledNotificationAsync(reminderId);
  await Notifications.cancelScheduledNotificationAsync(`${reminderId}_snooze`);
  console.log(`❌ Cancelled alarm for reminder: ${reminderId}`);
}

// Cancel all alarms for a user
export async function cancelAllUserAlarms(userId: string) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const userAlarms = scheduled.filter((n) => n.identifier.startsWith(userId));
  for (const alarm of userAlarms) {
    await Notifications.cancelScheduledNotificationAsync(alarm.identifier);
  }
}

// Setup notification categories for action buttons (Android/iOS)
export async function setupNotificationCategories() {
  await Notifications.setNotificationCategoryAsync("medication_action", [
    {
      identifier: "TAKE",
      buttonTitle: "💊 Take",
      options: {
        isDestructive: false,
        isAuthenticationRequired: false,
      },
    },
    {
      identifier: "SNOOZE",
      buttonTitle: "⏰ Snooze (10min)",
      options: {
        isDestructive: false,
        isAuthenticationRequired: false,
      },
    },
    {
      identifier: "SKIP",
      buttonTitle: "❌ Skip",
      options: {
        isDestructive: true,
        isAuthenticationRequired: false,
      },
    },
  ]);
}

// Handle notification response (when user taps action buttons)
export function handleNotificationResponse(
  response: Notifications.NotificationResponse,
  onTake: (reminderId: string) => void,
  onSnooze: (reminderId: string) => void,
  onSkip: (reminderId: string) => void,
) {
  const { actionIdentifier } = response;
  const data = response.notification.request.content.data;
  const { reminderId, type } = data;

  if (type !== "medication_reminder") return;

  switch (actionIdentifier) {
    case "TAKE":
      onTake(reminderId);
      break;
    case "SNOOZE":
      onSnooze(reminderId);
      break;
    case "SKIP":
      onSkip(reminderId);
      break;
    default:
      // User tapped the notification body
      console.log("Notification tapped:", reminderId);
      break;
  }
}
