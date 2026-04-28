// services/reminderAlarmService.ts
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

const DAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};
export function getReminderLogIdWithTime(
  reminderId: string,
  time: string,
  dateKey: string,
): string {
  return `${reminderId}_${time}_${dateKey.replace(/\s/g, "_")}`;
}
export async function scheduleMedicationAlarm(
  reminderId: string,
  medicationName: string,
  dosage: string,
  times: string[],
  days: string[],
) {
  await cancelMedicationAlarm(reminderId);

  const content = {
    title: "💊 Medication Reminder",
    body: `Time to take ${medicationName} ${dosage}`,
    sound: "alarm.mp3",
    priority: Notifications.AndroidNotificationPriority.MAX, // ✅ MAX not HIGH
    categoryIdentifier: "medication_action",
    android: {
      channelId: "medication-alarms-v2", // ✅ New channel ID
    },
    data: {
      reminderId,
      medicationName,
      dosage,
      type: "medication_reminder",
      action: "take",
    },
  };

  // ✅ Fallback to daily if no days provided
  const useDailyFallback = !days || days.length === 0;

  let scheduled = 0;

  if (useDailyFallback) {
    for (const time of times) {
      const [hours, minutes] = time.split(":").map(Number);

      await Notifications.scheduleNotificationAsync({
        identifier: `${reminderId}_daily_${time}`, // ✅ Add identifier
        content: {
          ...content, // ✅ Use the medication content, NOT test
          data: { ...content.data, time },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour: hours,
          minute: minutes,
          repeats: true,
        },
      });

      scheduled++;
    }
  } else {
    for (const day of days) {
      const jsWeekday = DAY_MAP[day];
      if (jsWeekday === undefined) {
        console.warn(`⚠️ Unknown day: "${day}", skipping`);
        continue;
      }

      const expoWeekday = jsWeekday + 1;

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
  }

  if (scheduled === 0) {
    console.warn(
      `⚠️ No alarms scheduled for ${medicationName} — check days/times`,
    );
  } else {
    console.log(`✅ Scheduled ${scheduled} alarms for ${medicationName}`);
  }
}

export async function scheduleSnoozeAlarm(
  reminderId: string,
  medicationName: string,
  dosage: string,
  snoozeMinutes: number = 10,
) {
  // ✅ Cancel any existing snooze before scheduling a new one
  await Notifications.cancelScheduledNotificationAsync(`${reminderId}_snooze`);

  await Notifications.scheduleNotificationAsync({
    identifier: `${reminderId}_snooze`,
    content: {
      title: "🔔 Snooze Reminder",
      body: `Don't forget to take ${medicationName} ${dosage}`,
      sound: "alarm.mp3",
      priority: Notifications.AndroidNotificationPriority.MAX,
      categoryIdentifier: "medication_action",
      android: {
        channelId: "medication-alarms-v2", // ✅ Same new channel
      },
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
      seconds: snoozeMinutes * 60,
    },
  });
}

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

// ✅ Fixed: filter by reminderId prefix, not userId
export async function cancelAllAlarmsForReminders(reminderIds: string[]) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();

  for (const notification of scheduled) {
    const belongsToReminder = reminderIds.some(
      (id) =>
        notification.identifier === id ||
        notification.identifier.startsWith(`${id}_`),
    );
    if (belongsToReminder) {
      await Notifications.cancelScheduledNotificationAsync(
        notification.identifier,
      );
    }
  }

  console.log(`❌ Cancelled alarms for ${reminderIds.length} reminders`);
}

export async function setupNotificationCategories() {
  if (Platform.OS === "android") {
    // ✅ Use a NEW channel ID to force recreation with proper settings
    await Notifications.setNotificationChannelAsync("medication-alarms-v2", {
      name: "Medication Alarms",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 500, 200, 500, 200, 500, 200, 500, 200, 500],
      sound: "alarm.mp3",
      enableVibrate: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: true,
    });
  }
  await Notifications.setNotificationCategoryAsync("medication_action", [
    {
      identifier: "TAKE",
      buttonTitle: "💊 Take",
      options: { isDestructive: false, isAuthenticationRequired: false },
    },
    {
      identifier: "SNOOZE",
      buttonTitle: "⏰ Snooze (10min)",
      options: { isDestructive: false, isAuthenticationRequired: false },
    },
    {
      identifier: "SKIP",
      buttonTitle: "❌ Skip",
      options: { isDestructive: true, isAuthenticationRequired: false },
    },
  ]);
}

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
      console.log("Notification tapped (no action):", reminderId);
      break;
  }
}
