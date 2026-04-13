// contexts/SelectedPatientContext.tsx
import { doc, getDoc } from "firebase/firestore";
import React, { createContext, useContext, useEffect, useState } from "react";
import { auth, db } from "../lib/firebase";

interface SelectedPatientContextType {
  selectedPatientId: string | null;
  setSelectedPatientId: (id: string | null) => void;
  userType: string | null;
}

const SelectedPatientContext = createContext<
  SelectedPatientContextType | undefined
>(undefined);

export function SelectedPatientProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(
    null,
  );
  const [userType, setUserType] = useState<string | null>(null);

  useEffect(() => {
    const loadUserType = async () => {
      const userId = auth.currentUser?.uid;
      if (!userId) return;
      const userDoc = await getDoc(doc(db, "users", userId));
      const type = userDoc.data()?.userType;
      setUserType(type);
    };
    loadUserType();
  }, []);

  return (
    <SelectedPatientContext.Provider
      value={{ selectedPatientId, setSelectedPatientId, userType }}
    >
      {children}
    </SelectedPatientContext.Provider>
  );
}

export function useSelectedPatient() {
  const context = useContext(SelectedPatientContext);
  if (context === undefined) {
    throw new Error(
      "useSelectedPatient must be used within a SelectedPatientProvider",
    );
  }
  return context;
}
