// lib/scheduleSnapshot.ts
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "./firebase";

export interface SnapshotItem {
  reminderId: string;
  medicationId: string;
  name: string;
  dosage: string;
  time: string;
}

export function snapshotKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Create snapshot for any date (past, present, or future)
 */
export async function createSnapshotForDate(
  userId: string,
  date: Date,
  reminders: {
    id: string;
    medicationId: string;
    medicationName: string;
    medicationDosage: string;
    times: string[];
    days: string[];
    enabled: boolean;
    createdAt?: any;
  }[],
): Promise<void> {
  const normalizedDate = new Date(date);
  normalizedDate.setHours(0, 0, 0, 0);

  const sk = snapshotKey(normalizedDate);
  const snapRef = doc(db, "users", userId, "schedule_snapshots", sk);
  const snapDoc = await getDoc(snapRef);

  // Don't overwrite existing snapshots
  if (snapDoc.exists()) {
    console.log(`📸 Snapshot already exists for ${sk}`);
    return;
  }

  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayName = DAY_NAMES[normalizedDate.getDay()];

  const items: SnapshotItem[] = reminders
    .filter((r) => {
      if (!r.enabled) return false;

      // One-time reminder (no days selected)
      if (!r.days || r.days.length === 0) {
        if (r.createdAt) {
          const createdDate = r.createdAt.toDate
            ? r.createdAt.toDate()
            : new Date(r.createdAt);
          const normalizedCreated = new Date(createdDate);
          normalizedCreated.setHours(0, 0, 0, 0);
          // One-time reminder appears on the day it was created
          return normalizedDate.getTime() === normalizedCreated.getTime();
        }
        return false;
      }

      // Recurring reminder - check if day matches
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
    console.log(`✅ Created snapshot for ${sk} with ${items.length} items`);
  }
}

/**
 * Backfill today's snapshot only
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
    createdAt?: any;
  }[],
): Promise<void> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const sk = snapshotKey(today);
  const snapRef = doc(db, "users", userId, "schedule_snapshots", sk);
  const snapDoc = await getDoc(snapRef);

  // Only create if it doesn't exist
  if (snapDoc.exists()) {
    console.log(`📸 Today's snapshot already exists`);
    return;
  }

  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayName = DAY_NAMES[today.getDay()];

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
    console.log(`✅ Created today's snapshot with ${items.length} items`);
  }
}

/**
 * Get snapshot for a specific date
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

// ❌ REMOVED cleanupPastSnapshots - we want to KEEP past snapshots!
