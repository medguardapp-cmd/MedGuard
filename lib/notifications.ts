import * as BackgroundFetch from "expo-background-fetch";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";

const BACKGROUND_TASK = "MEDICATION_REMINDER_TASK";

// ─── How notifications appear when app is open ───
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// ─── Request permissions ─────────────────────────
export async function requestNotificationPermissions() {
  const { status } = await Notifications.requestPermissionsAsync({
    android: {
      allowAlert: true,
      allowSound: true,
      allowVibrate: true,
    },
  });
  return status === "granted";
}

// ─── Set up Android notification channel ────────
export async function setupNotificationChannel() {
  await Notifications.setNotificationChannelAsync("medication-reminders", {
    name: "Medication Reminders",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    sound: "default",
    enableVibrate: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

// ─── Schedule all reminders ──────────────────────
export async function scheduleAllReminders(
  reminders: {
    id: strin;
    medicationName: string;
    medicationDosage: string;
    time: string;
    days: string[];
    enabled: boolean;
    sound: boolean;
    vibrate: boolean;
  }[],
) {
  [];
  // Cancel all existing scheduled notifications first
  await Notifications.cancelAllScheduledNotificationsAsync();

  const enabledReminders = reminders.filter((r) => r.enabled);

  for (const reminder of enabledReminders) {
    await scheduleReminder(reminder);
  }
}

// ─── Schedule a single reminder ──────────────────
export async function scheduleReminder(reminder: {
  id: string;
  medicationName: string;
  medicationDosage: string;
  time: string;
  days: string[];
  enabled: boolean;
  sound: boolean;
  vibrate: boolean;
}) {
  const [hours, minutes] = reminder.time.split(":").map(Number);
  const isOneTime = !reminder.days || reminder.days.length === 0;

  if (isOneTime) {
    // ── One-time: fire today or tomorrow ──
    const fireDate = new Date();
    fireDate.setHours(hours, minutes, 0, 0);

    // If time already passed today, schedule for tomorrow
    if (fireDate <= new Date()) {
      fireDate.setDate(fireDate.getDate() + 1);
    }

    await Notifications.scheduleNotificationAsync({
      identifier: `${reminder.id}-onetime`,
      content: {
        title: "💊 Time for your medication",
        body: `${reminder.medicationName} — ${reminder.medicationDosage}`,
        sound: reminder.sound ? "default" : undefined,
        vibrate: reminder.vibrate ? [0, 250, 250, 250] : undefined,
        data: {
          reminderId: reminder.id,
          isOneTime: true,
        },
        android: {
          channelId: "medication-reminders",
          priority: Notifications.AndroidNotificationPriority.MAX,
        },
      },
      trigger: {
        date: fireDate,
        channelId: "medication-reminders",
      },
    });
  } else {
    // ── Repeating: schedule for each selected day ──
    const DAY_MAP: Record<string, number> = {
      Sun: 1,
      Mon: 2,
      Tue: 3,
      Wed: 4,
      Thu: 5,
      Fri: 6,
      Sat: 7,
    };

    for (const day of reminder.days) {
      const weekday = DAY_MAP[day];
      if (!weekday) continue;

      await Notifications.scheduleNotificationAsync({
        identifier: `${reminder.id}-${day}`,
        content: {
          title: "💊 Time for your medication",
          body: `${reminder.medicationName} — ${reminder.medicationDosage}`,
          sound: reminder.sound ? "default" : undefined,
          vibrate: reminder.vibrate ? [0, 250, 250, 250] : undefined,
          data: {
            reminderId: reminder.id,
            isOneTime: false,
          },
          android: {
            channelId: "medication-reminders",
            priority: Notifications.AndroidNotificationPriority.MAX,
          },
        },
        trigger: {
          weekday,
          hour: hours,
          minute: minutes,
          repeats: true,
          channelId: "medication-reminders",
        },
      });
    }
  }
}

// ─── Cancel a single reminder's notifications ────
export async function cancelReminder(reminderId: string) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const toCancel = scheduled.filter((n) => n.identifier.startsWith(reminderId));
  for (const n of toCancel) {
    await Notifications.cancelScheduledNotificationAsync(n.identifier);
  }
}

// ─── Background task: auto-disable one-time ──────
TaskManager.defineTask(BACKGROUND_TASK, async () => {
  try {
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function registerBackgroundTask() {
  await BackgroundFetch.registerTaskAsync(BACKGROUND_TASK, {
    minimumInterval: 60,
    stopOnTerminate: false,
    startOnBoot: true,
  });
}
