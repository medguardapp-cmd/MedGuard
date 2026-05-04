//services/AlarmModule.ts
import { NativeEventEmitter, NativeModules, Platform } from "react-native";

const { AlarmModule: NativeAlarm } = NativeModules;

if (!NativeAlarm && Platform.OS === "android") {
  console.error("AlarmModule not found — did you run npx expo run:android?");
}

export interface AlarmOptions {
  id: string;
  label: string;
  hour: number;
  minute: number;
  repeat: "daily" | "weekly";
  weekday?: number; // 0=Sun, 1=Mon, ..., 6=Sat
  reminderId: string;
  medicationName: string;
  dosage: string;
}

export type AlarmAction = "TAKE" | "SNOOZE" | "SKIP";

export interface AlarmActionEvent {
  action: AlarmAction;
  reminderId: string;
  alarmId: string;
}

const emitter = NativeAlarm ? new NativeEventEmitter(NativeAlarm) : null;

export const AlarmModule = {
  scheduleAlarm: async (options: AlarmOptions): Promise<string> => {
    if (Platform.OS !== "android") return "skipped:ios";
    return NativeAlarm.scheduleAlarm(options);
  },

  cancelAlarm: async (alarmId: string): Promise<string> => {
    if (Platform.OS !== "android") return "skipped:ios";
    return NativeAlarm.cancelAlarm(alarmId);
  },

  cancelAlarmsWithPrefix: async (prefix: string): Promise<number> => {
    if (Platform.OS !== "android") return 0;
    return NativeAlarm.cancelAlarmsWithPrefix(prefix);
  },

  onAlarmAction: (callback: (event: AlarmActionEvent) => void) => {
    if (!emitter) return { remove: () => {} };
    const sub = emitter.addListener("AlarmAction", callback);
    return sub;
  },
};
