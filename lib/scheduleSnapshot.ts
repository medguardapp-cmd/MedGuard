// lib/scheduleSnapshot.ts
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "./firebase";

export interface SnapshotItem {
  reminderId: string;
  medicationId: string;
  name: string;
  dosage: string;
  time: string; // one entry per time slot
}

export function snapshotKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function upsertReminderSnapshot(
  userId: string,
  reminder: {
    id: string;
    medicationId: string;
    medicationName: string;
    medicationDosage: string;
    times: string[];
    days: string[];
    enabled: boolean;
  },
  today: Date = new Date(),
): Promise<void> {
  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayName = DAY_NAMES[today.getDay()];
  const fitsToday =
    !reminder.days || reminder.days.length === 0
      ? true
      : reminder.days.includes(dayName);

  if (!fitsToday || !reminder.enabled) return;

  const sk = snapshotKey(today);
  const snapRef = doc(db, "users", userId, "schedule_snapshots", sk);
  const snapDoc = await getDoc(snapRef);

  // One SnapshotItem per time slot
  const newItems: SnapshotItem[] = reminder.times.map((t) => ({
    reminderId: reminder.id,
    medicationId: reminder.medicationId,
    name: reminder.medicationName,
    dosage: reminder.medicationDosage,
    time: t,
  }));

  if (snapDoc.exists()) {
    const existing: SnapshotItem[] = snapDoc.data()?.items ?? [];
    // Remove all existing entries for this reminderId, then append new ones
    const filtered = existing.filter((i) => i.reminderId !== reminder.id);
    await setDoc(
      snapRef,
      { items: [...filtered, ...newItems], savedAt: serverTimestamp() },
      { merge: true },
    );
  } else {
    await setDoc(snapRef, { items: newItems, savedAt: serverTimestamp() });
  }
}

export async function removeReminderFromTodaySnapshot(
  userId: string,
  reminderId: string,
  today: Date = new Date(),
): Promise<void> {
  const sk = snapshotKey(today);
  const snapRef = doc(db, "users", userId, "schedule_snapshots", sk);
  const snapDoc = await getDoc(snapRef);
  if (!snapDoc.exists()) return;

  const existing: SnapshotItem[] = snapDoc.data()?.items ?? [];
  const updated = existing.filter((i) => i.reminderId !== reminderId);
  await setDoc(
    snapRef,
    { items: updated, savedAt: serverTimestamp() },
    { merge: true },
  );
}

/**
 * Backfill snapshot for a specific date
 * IMPORTANT: Only backfills TODAY's snapshot, never past dates
 */
export async function backfillTodaySnapshot(
  userId: string,
  reminders: {
    id: string;
    medicationId: string;
    medicationName: string;
    medicationDosage: string;
    times: string[];
    days: string[];
    enabled: boolean;
  }[],
  date: Date = new Date(),
): Promise<void> {
  const sk = snapshotKey(date);
  const snapRef = doc(db, "users", userId, "schedule_snapshots", sk);
  const snapDoc = await getDoc(snapRef);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const normalizedDate = new Date(date);
  normalizedDate.setHours(0, 0, 0, 0);
  const isToday = normalizedDate.getTime() === today.getTime();
  const isPast = normalizedDate < today;

  // NEVER backfill past dates - they should remain as they were or be empty
  if (isPast) {
    return;
  }

  // Only create snapshot for today if it doesn't exist
  if (isToday && !snapDoc.exists()) {
    const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const dayName = DAY_NAMES[normalizedDate.getDay()];

    const items: SnapshotItem[] = reminders
      .filter((r) => {
        if (!r.enabled) return false;
        if (!r.days || r.days.length === 0) return true;
        return r.days.includes(dayName);
      })
      .flatMap((r) =>
        r.times.map((t) => ({
          reminderId: r.id,
          medicationId: r.medicationId,
          name: r.medicationName,
          dosage: r.medicationDosage,
          time: t,
        })),
      );

    if (items.length > 0) {
      await setDoc(snapRef, { items, savedAt: serverTimestamp() });
    }
  }
}

/**
 * Clean up incorrectly created past snapshots
 * This should be called once to clean up any bad data
 */
export async function cleanupPastSnapshots(userId: string): Promise<void> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Check last 30 days
  for (let i = 1; i <= 30; i++) {
    const pastDate = new Date(today);
    pastDate.setDate(today.getDate() - i);
    const sk = snapshotKey(pastDate);
    const snapRef = doc(db, "users", userId, "schedule_snapshots", sk);
    const snapDoc = await getDoc(snapRef);

    if (snapDoc.exists()) {
      // Delete or clear past snapshots since they shouldn't exist
      await setDoc(snapRef, { items: [], savedAt: serverTimestamp() });
      console.log(`Cleaned up snapshot for ${sk}`);
    }
  }
}

/**
 * Get snapshot for a specific date (returns null if not exists)
 */
export async function getSnapshot(
  userId: string,
  date: Date,
): Promise<SnapshotItem[] | null> {
  const sk = snapshotKey(date);
  const snapRef = doc(db, "users", userId, "schedule_snapshots", sk);
  const snapDoc = await getDoc(snapRef);

  if (snapDoc.exists()) {
    return snapDoc.data()?.items ?? [];
  }
  return null;
}
