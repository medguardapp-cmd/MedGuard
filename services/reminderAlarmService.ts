// services/reminderAlarmService.ts
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

// Schedule a medication reminder alarm
export async function scheduleMedicationAlarm(
  reminderId: string,
  medicationName: string,
  dosage: string,
  scheduledTime: Date,
  options?: {
    repeat?: boolean;
    weekdays?: number[];
  },
) {
  await Notifications.cancelScheduledNotificationAsync(reminderId);

  let trigger: any;

  if (options?.repeat && options.weekdays && options.weekdays.length > 0) {
    trigger = {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      hour: scheduledTime.getHours(),
      minute: scheduledTime.getMinutes(),
      weekday: options.weekdays[0] + 1,
      repeats: true,
    };
  } else if (options?.repeat) {
    trigger = {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: scheduledTime.getHours(),
      minute: scheduledTime.getMinutes(),
      repeats: true,
    };
  } else {
    const secondsFromNow = Math.max(
      1,
      Math.floor((scheduledTime.getTime() - Date.now()) / 1000),
    );
    trigger = {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: secondsFromNow,
    };
  }

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
  const secondsFromNow = snoozeMinutes * 60;

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
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: secondsFromNow,
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

// Setup notification categories for action buttons
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

// Handle notification response
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
      console.log("Notification tapped:", reminderId);
      break;
  }
}
