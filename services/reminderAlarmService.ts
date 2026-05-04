import { Platform } from "react-native";
import { AlarmActionEvent, AlarmModule } from "./AlarmModule";

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
  // Cancel existing before rescheduling
  await cancelMedicationAlarm(reminderId);

  if (Platform.OS !== "android") return;

  const useDailyFallback = !days || days.length === 0;
  let scheduled = 0;

  if (useDailyFallback) {
    for (const time of times) {
      const [hour, minute] = time.split(":").map(Number);
      const alarmId = `${reminderId}_daily_${time}`;

      await AlarmModule.scheduleAlarm({
        id: alarmId,
        label: `Time to take ${medicationName} ${dosage}`,
        hour,
        minute,
        repeat: "daily",
        reminderId,
        medicationName,
        dosage,
      });

      scheduled++;
    }
  } else {
    for (const day of days) {
      const weekday = DAY_MAP[day];
      if (weekday === undefined) {
        console.warn(`⚠️ Unknown day: "${day}", skipping`);
        continue;
      }

      for (const time of times) {
        const [hour, minute] = time.split(":").map(Number);
        const alarmId = `${reminderId}_${day}_${time}`;

        await AlarmModule.scheduleAlarm({
          id: alarmId,
          label: `Time to take ${medicationName} ${dosage}`,
          hour,
          minute,
          repeat: "weekly",
          weekday,
          reminderId,
          medicationName,
          dosage,
        });

        scheduled++;
      }
    }
  }

  if (scheduled === 0) {
    console.warn(`⚠️ No alarms scheduled for ${medicationName}`);
  } else {
    console.log(`✅ Scheduled ${scheduled} alarms for ${medicationName}`);
  }
}

export async function cancelMedicationAlarm(reminderId: string) {
  if (Platform.OS !== "android") return;
  const cancelled = await AlarmModule.cancelAlarmsWithPrefix(reminderId);
  console.log(`❌ Cancelled ${cancelled} alarms for: ${reminderId}`);
}

export function listenForAlarmActions(
  onTake: (reminderId: string) => void,
  onSnooze: (reminderId: string) => void,
  onSkip: (reminderId: string) => void,
) {
  return AlarmModule.onAlarmAction((event: AlarmActionEvent) => {
    switch (event.action) {
      case "TAKE":
        onTake(event.reminderId);
        break;
      case "SNOOZE":
        onSnooze(event.reminderId);
        break;
      case "SKIP":
        onSkip(event.reminderId);
        break;
    }
  });
}
