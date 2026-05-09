import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

const ALARMS_STORAGE_KEY = "@medication_alarms";

interface ScheduledAlarm {
  id: string;
  medicationName: string;
  dosage: string;
  times: string[];
  days: string[];
  enabled: boolean;
  userId: string;
}

export const saveAlarmsToStorage = async (alarms: ScheduledAlarm[]) => {
  try {
    await AsyncStorage.setItem(ALARMS_STORAGE_KEY, JSON.stringify(alarms));
  } catch (error) {
    console.error("Error saving alarms:", error);
  }
};

export const loadAlarmsFromStorage = async (): Promise<ScheduledAlarm[]> => {
  try {
    const data = await AsyncStorage.getItem(ALARMS_STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error("Error loading alarms:", error);
    return [];
  }
};

export const rescheduleAllAlarms = async () => {
  try {
    const savedAlarms = await loadAlarmsFromStorage();

    if (savedAlarms.length === 0) {
      console.log("No saved alarms to reschedule");
      return;
    }

    // Cancel all existing scheduled notifications first
    await Notifications.cancelAllScheduledNotificationsAsync();

    console.log(`Rescheduling ${savedAlarms.length} alarms...`);

    for (const alarm of savedAlarms) {
      if (!alarm.enabled) continue;
      await schedulePersistentAlarm(alarm);
    }

    console.log("All alarms rescheduled successfully");
  } catch (error) {
    console.error("Error rescheduling alarms:", error);
  }
};

export const schedulePersistentAlarm = async (alarm: ScheduledAlarm) => {
  const now = new Date();

  for (const time of alarm.times) {
    const [hours, minutes] = time.split(":").map(Number);

    if (alarm.days.length === 0) {
      // One-time alarm
      const scheduledDate = new Date();
      scheduledDate.setHours(hours, minutes, 0, 0);

      // If time has passed today, schedule for tomorrow
      if (scheduledDate <= now) {
        scheduledDate.setDate(scheduledDate.getDate() + 1);
      }

      // Only schedule if it's within next 24 hours
      const diffMs = scheduledDate.getTime() - now.getTime();
      if (diffMs > 0 && diffMs <= 24 * 60 * 60 * 1000) {
        const identifier = `${alarm.id}_${time}_${alarm.userId}_onetime`;

        // Cancel existing with same ID
        await Notifications.cancelScheduledNotificationAsync(identifier);

        await Notifications.scheduleNotificationAsync({
          identifier,
          content: {
            title: "💊 Time to Take Medication",
            body: `${alarm.medicationName} - ${alarm.dosage}`,
            sound: "default",
            priority: Notifications.AndroidNotificationPriority.HIGH,
            data: {
              reminderId: alarm.id,
              userId: alarm.userId,
              medicationName: alarm.medicationName,
              dosage: alarm.dosage,
              type: "scheduled-dose",
            },
          },
          trigger: {
            date: scheduledDate,
            channelId:
              Platform.OS === "android" ? "medication-alarms" : undefined,
          },
        });
      }
    } else {
      // Recurring alarm
      for (const day of alarm.days) {
        const dayIndex = [
          "Sun",
          "Mon",
          "Tue",
          "Wed",
          "Thu",
          "Fri",
          "Sat",
        ].indexOf(day);

        if (dayIndex === -1) continue;

        const identifier = `${alarm.id}_${time}_${day}_${alarm.userId}`;

        // Cancel existing with same ID
        await Notifications.cancelScheduledNotificationAsync(identifier);

        await Notifications.scheduleNotificationAsync({
          identifier,
          content: {
            title: "💊 Time to Take Medication",
            body: `${alarm.medicationName} - ${alarm.dosage}`,
            sound: "default",
            priority: Notifications.AndroidNotificationPriority.HIGH,
            data: {
              reminderId: alarm.id,
              userId: alarm.userId,
              medicationName: alarm.medicationName,
              dosage: alarm.dosage,
              type: "scheduled-dose",
            },
          },
          trigger: {
            hour: hours,
            minute: minutes,
            weekday: dayIndex + 1, // 1-7 format (Sunday = 1)
            repeats: true,
            channelId: Platform.OS === "android" ? "medications" : undefined,
          },
        });
      }
    }
  }
};

export const addOrUpdateAlarm = async (alarm: ScheduledAlarm) => {
  try {
    const alarms = await loadAlarmsFromStorage();
    const existingIndex = alarms.findIndex((a) => a.id === alarm.id);

    if (existingIndex >= 0) {
      alarms[existingIndex] = alarm;
      console.log("Updated existing alarm in storage:", alarm.id);
    } else {
      alarms.push(alarm);
      console.log("Added new alarm to storage:", alarm.id);
    }

    await saveAlarmsToStorage(alarms);

    // Cancel old notifications for this alarm
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const notif of scheduled) {
      if (notif.identifier.includes(alarm.id)) {
        await Notifications.cancelScheduledNotificationAsync(notif.identifier);
      }
    }

    // Reschedule if enabled
    if (alarm.enabled) {
      await schedulePersistentAlarm(alarm);
    }
  } catch (error) {
    console.error("Error in addOrUpdateAlarm:", error);
  }
};

export const removeAlarm = async (alarmId: string) => {
  try {
    const alarms = await loadAlarmsFromStorage();
    const filtered = alarms.filter((a) => a.id !== alarmId);
    await saveAlarmsToStorage(filtered);
    console.log("Removed alarm from storage:", alarmId);

    // Cancel all notifications for this alarm
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const notif of scheduled) {
      if (notif.identifier.includes(alarmId)) {
        await Notifications.cancelScheduledNotificationAsync(notif.identifier);
      }
    }
  } catch (error) {
    console.error("Error in removeAlarm:", error);
  }
};
