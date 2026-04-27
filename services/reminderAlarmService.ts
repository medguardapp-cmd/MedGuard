// services/reminderAlarmService.ts
import * as Notifications from "expo-notifications";

// Map day names to JS weekday numbers (0 = Sunday, 6 = Saturday)
const DAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

// Schedule medication alarms for multiple days and times
export async function scheduleMedicationAlarm(
  reminderId: string,
  medicationName: string,
  dosage: string,
  times: string[], // ["04:00", "16:00"]
  days: string[], // ["Mon", "Tue", "Wed"]
) {
  // Cancel existing alarms for this reminder
  await cancelMedicationAlarm(reminderId);

  const content = {
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
  };

  let scheduled = 0;

  for (const day of days) {
    const jsWeekday = DAY_MAP[day];
    if (jsWeekday === undefined) continue;

    const expoWeekday = jsWeekday + 1; // JS 0-6 → Expo 1-7

    for (const time of times) {
      const [hours, minutes] = time.split(":").map(Number);

      await Notifications.scheduleNotificationAsync({
        identifier: `${reminderId}_${day}_${time}`,
        content: {
          ...content,
          data: { ...content.data, day, time },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          hour: hours,
          minute: minutes,
          weekday: expoWeekday,
          repeats: true,
        },
      });

      scheduled++;
    }
  }

  console.log(`✅ Scheduled ${scheduled} alarms for ${medicationName}`);
}

// Schedule a snooze alarm
export async function scheduleSnoozeAlarm(
  reminderId: string,
  medicationName: string,
  dosage: string,
  snoozeMinutes: number = 10,
) {
  const secondsFromNow = snoozeMinutes * 60;

  await Notifications.scheduleNotificationAsync({
    identifier: `${reminderId}_snooze`,
    content: {
      title: "🔔 Snooze Reminder",
      body: `Don't forget to take ${medicationName} ${dosage}`,
      sound: "default",
      priority: Notifications.AndroidNotificationPriority.HIGH,
      categoryIdentifier: "medication_action",
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

// Cancel all alarms for a reminder
export async function cancelMedicationAlarm(reminderId: string) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();

  const toCancel = scheduled.filter(
    (n) =>
      n.identifier === reminderId || n.identifier.startsWith(`${reminderId}_`),
  );

  for (const notification of toCancel) {
    await Notifications.cancelScheduledNotificationAsync(
      notification.identifier,
    );
  }

  console.log(`❌ Cancelled ${toCancel.length} alarms for: ${reminderId}`);
}

// Cancel all alarms for a user
export async function cancelAllUserAlarms(userId: string) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const userAlarms = scheduled.filter((n) => n.identifier.startsWith(userId));
  for (const alarm of userAlarms) {
    await Notifications.cancelScheduledNotificationAsync(alarm.identifier);
  }
}

// Setup notification categories
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
