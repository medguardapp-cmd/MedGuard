// lib/tabEvents.ts
// A lightweight event bus for communicating between tabs
// without needing a full state management library.
//
// Usage:
//   // In the receiving screen (medications.tsx):
//   tabEvents.on("openReactions", () => setActiveTab("reactions"));
//
//   // In the sending screen (index.tsx):
//   tabEvents.emit("openReactions");

type EventName =
  | "openReactions"
  | "openAddMedication"
  | "openAddReminder"
  | "openLogReaction";
type Listener = () => void;

const listeners: Partial<Record<EventName, Listener[]>> = {};

export const tabEvents = {
  on(event: EventName, listener: Listener) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event]!.push(listener);
    // Return cleanup function
    return () => {
      listeners[event] = listeners[event]!.filter((l) => l !== listener);
    };
  },

  emit(event: EventName) {
    listeners[event]?.forEach((l) => l());
  },
};
