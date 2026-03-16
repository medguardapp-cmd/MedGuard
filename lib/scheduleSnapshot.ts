// lib/scheduleSnapshot.ts
// Schedule snapshot helpers — used by both medications.tsx and index.tsx
// Keeping this in lib/ avoids circular imports between tab screens.
//
// Firestore path: users/{uid}/schedule_snapshots/{YYYY-MM-DD}
// Doc shape: { savedAt: timestamp, items: SnapshotItem[] }

import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "./firebase";

export interface SnapshotItem {
  reminderId: string;
  medicationId: string;
  name: string;
  dosage: string;
  time: string;
}

// "YYYY-MM-DD" key for a given date
export function snapshotKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Upsert a single reminder into today's schedule_snapshot.
 * Called from medications.tsx whenever a reminder is saved (create or edit).
 * Only writes if the reminder is enabled AND applies to today.
 */
export async function upsertReminderSnapshot(
  userId: string,
  reminder: {
    id: string;
    medicationId: string;
    medicationName: string;
    medicationDosage: string;
    time: string;
    days: string[];
    enabled: boolean;
  },
  today: Date = new Date(),
): Promise<void> {
  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayName = DAY_NAMES[today.getDay()];
  const fitsToday =
    !reminder.days || reminder.days.length === 0
      ? true // one-time reminder always counts today
      : reminder.days.includes(dayName);

  if (!fitsToday || !reminder.enabled) return;

  const sk = snapshotKey(today);
  const snapRef = doc(db, "users", userId, "schedule_snapshots", sk);
  const snapDoc = await getDoc(snapRef);

  const newItem: SnapshotItem = {
    reminderId: reminder.id,
    medicationId: reminder.medicationId,
    name: reminder.medicationName,
    dosage: reminder.medicationDosage,
    time: reminder.time,
  };

  if (snapDoc.exists()) {
    const existing: SnapshotItem[] = snapDoc.data()?.items ?? [];
    // Replace existing entry for this reminderId, or append
    const updated = existing.filter((i) => i.reminderId !== reminder.id);
    updated.push(newItem);
    await setDoc(
      snapRef,
      { items: updated, savedAt: serverTimestamp() },
      { merge: true },
    );
  } else {
    await setDoc(snapRef, { items: [newItem], savedAt: serverTimestamp() });
  }
}

/**
 * Remove a reminder from TODAY's snapshot only.
 * Called from medications.tsx when a reminder is deleted.
 * Past snapshots are intentionally left untouched — they are history.
 */
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
 * One-time backfill: write today's snapshot from all current reminders.
 * Called from index.tsx on first load. Safe to call multiple times —
 * skips if snapshot already exists.
 */
export async function backfillTodaySnapshot(
  userId: string,
  reminders: {
    id: string;
    medicationId: string;
    medicationName: string;
    medicationDosage: string;
    time: string;
    days: string[];
    enabled: boolean;
  }[],
  today: Date = new Date(),
): Promise<void> {
  const sk = snapshotKey(today);
  const snapRef = doc(db, "users", userId, "schedule_snapshots", sk);
  const snapDoc = await getDoc(snapRef);
  if (snapDoc.exists()) return; // already written today

  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayName = DAY_NAMES[today.getDay()];

  const items: SnapshotItem[] = reminders
    .filter((r) => {
      if (!r.enabled) return false;
      if (!r.days || r.days.length === 0) return true;
      return r.days.includes(dayName);
    })
    .map((r) => ({
      reminderId: r.id,
      medicationId: r.medicationId,
      name: r.medicationName,
      dosage: r.medicationDosage,
      time: r.time,
    }));

  if (items.length > 0) {
    await setDoc(snapRef, { items, savedAt: serverTimestamp() });
  }
}
