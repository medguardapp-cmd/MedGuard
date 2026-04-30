// contexts/CaregiverContext.tsx
import { collection, onSnapshot, query, where } from "firebase/firestore";
import React, { createContext, useContext, useEffect, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { db } from "../lib/firebase";
import { useOnboarding } from "./OnboardingContext";

interface CaregiverContextType {
  hasPatients: boolean;
  loading: boolean;
  patientCount: number;
}

const CaregiverContext = createContext<CaregiverContextType | undefined>(
  undefined,
);

export const useCaregiverStatus = () => {
  const context = useContext(CaregiverContext);
  if (!context) {
    throw new Error("useCaregiverStatus must be used within CaregiverProvider");
  }
  return context;
};

export const CaregiverProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user } = useAuth();
  const { data } = useOnboarding();
  const [hasPatients, setHasPatients] = useState(false);
  const [patientCount, setPatientCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || data.userData.userType !== "caregiver") {
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, "caregiver_connections"),
      where("caregiverId", "==", user.uid),
      where("status", "==", "approved"),
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const count = snapshot.docs.length;
      setPatientCount(count);
      setHasPatients(count > 0);
      setLoading(false);
    });

    return unsubscribe;
  }, [user, data.userData.userType]);

  return (
    <CaregiverContext.Provider value={{ hasPatients, loading, patientCount }}>
      {children}
    </CaregiverContext.Provider>
  );
};
