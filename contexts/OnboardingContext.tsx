// contexts/OnboardingContext.tsx - UPDATED
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, ReactNode, useContext, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import {
    MedicalData,
    OnboardingData,
    UserData
} from "../types/onboarding";

const ONBOARDING_COMPLETED_KEY = "@medguard_onboarding_completed";

interface OnboardingContextType {
  data: OnboardingData;
  currentStep: number;
  updateUserData: (userData: Partial<UserData>) => void;
  updateMedicalData: (medicalData: Partial<MedicalData>) => void;
  setCurrentStep: (step: number) => void;
  completeOnboarding: () => Promise<void>;
  isCompleted: boolean;
}

const defaultUserData: UserData = {
  userType: "patient",
  name: "",
  dateOfBirth: "",
  gender: "",
  contactInfo: {
    phone: "",
    address: "",
    emergencyContact: "",
  },
};

const defaultMedicalData: MedicalData = {
  conditions: [],
  allergies: [],
  medications: [],
  bloodType: "",
  height: "",
  weight: "",
  notes: "",
};

const defaultData: OnboardingData = {
  userData: defaultUserData,
  medicalData: defaultMedicalData,
};

const OnboardingContext = createContext<OnboardingContextType | undefined>(
  undefined,
);

export const useOnboarding = () => {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error("useOnboarding must be used within OnboardingProvider");
  }
  return context;
};

interface OnboardingProviderProps {
  children: ReactNode;
}

export const OnboardingProvider: React.FC<OnboardingProviderProps> = ({
  children,
}) => {
  const { user } = useAuth();
  const [data, setData] = useState<OnboardingData>(defaultData);
  const [currentStep, setCurrentStep] = useState(0);
  const [isCompleted, setIsCompleted] = useState(false);

  const updateUserData = (userData: Partial<UserData>) => {
    setData((prev) => ({
      ...prev,
      userData: { ...prev.userData, ...userData },
    }));
  };

  const updateMedicalData = (medicalData: Partial<MedicalData>) => {
    setData((prev) => ({
      ...prev,
      medicalData: { ...prev.medicalData, ...medicalData },
    }));
  };

  const completeOnboarding = async () => {
    try {
      console.log("Completing onboarding with data:", data);

      // Save to Firestore (optional - you can add this later)
      // await saveOnboardingDataToFirestore(user.uid, data);

      // Mark onboarding as completed in AsyncStorage
      if (user) {
        await AsyncStorage.setItem(
          `${ONBOARDING_COMPLETED_KEY}_${user.uid}`,
          "true",
        );
      }

      setIsCompleted(true);
    } catch (error) {
      console.error("Error completing onboarding:", error);
      throw error;
    }
  };

  return (
    <OnboardingContext.Provider
      value={{
        data,
        currentStep,
        updateUserData,
        updateMedicalData,
        setCurrentStep,
        completeOnboarding,
        isCompleted,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
};
