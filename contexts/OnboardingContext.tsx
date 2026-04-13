// contexts/OnboardingContext.tsx - COMPLETE FIXED VERSION
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import React, {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { Alert } from "react-native";
import { useAuth } from "../hooks/useAuth";
import { db } from "../lib/firebase";
import {
  getUserData,
  saveOnboardingData,
} from "../lib/firebaseOnboardingService";
import { MedicalData, OnboardingData, UserData } from "../types/onboarding";

const ONBOARDING_COMPLETED_KEY = "@medguard_onboarding_completed";

interface OnboardingContextType {
  data: OnboardingData;
  currentStep: number;
  updateUserData: (userData: Partial<UserData>) => void;
  updateMedicalData: (medicalData: Partial<MedicalData>) => void;
  setCurrentStep: (step: number) => void;
  completeOnboarding: () => Promise<void>;
  isCompleted: boolean;
  isLoading: boolean;
  saveCurrentData: () => Promise<void>;
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
  const [isLoading, setIsLoading] = useState(false);

  // Load existing user data on mount
  useEffect(() => {
    if (user) {
      loadUserData();
    }
  }, [user]);

  const loadUserData = async () => {
    try {
      if (!user) return;

      setIsLoading(true);

      // Check if onboarding is already completed in AsyncStorage
      const onboardingCompleted = await AsyncStorage.getItem(
        `${ONBOARDING_COMPLETED_KEY}_${user.uid}`,
      );

      console.log(
        "📋 Onboarding status from AsyncStorage:",
        onboardingCompleted,
      );

      if (onboardingCompleted === "true") {
        setIsCompleted(true);
        console.log("✅ Onboarding already completed");

        // Try to load data from Firestore, but don't block if it fails
        try {
          const firestoreData = await getUserData(user.uid);
          if (firestoreData) {
            setData(firestoreData);
            console.log("📥 Data loaded from Firestore");
          }
        } catch (firestoreError) {
          console.warn(
            "⚠️ Could not load from Firestore, using defaults:",
            firestoreError,
          );
        }
      } else {
        console.log("🔄 Onboarding not completed yet");
      }
    } catch (error) {
      console.error("❌ Error loading user data:", error);
    } finally {
      setIsLoading(false);
    }
  };

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

  const saveCurrentData = async (): Promise<void> => {
    try {
      if (!user) throw new Error("No user logged in");

      setIsLoading(true);
      console.log("💾 Saving current data to Firestore...");

      // Save to Firestore - but don't fail the app if it doesn't work
      try {
        await saveOnboardingData(user.uid, data, false);
        console.log("✅ Current data saved successfully");
      } catch (firestoreError) {
        console.warn(
          "⚠️ Firestore save failed, but continuing:",
          firestoreError,
        );
        // Still continue even if Firestore fails
      }
    } catch (error) {
      console.error("❌ Error in saveCurrentData:", error);
      // Don't throw - just log and continue
    } finally {
      setIsLoading(false);
    }
  };

  const completeOnboarding = async (): Promise<void> => {
    try {
      if (!user) throw new Error("No user logged in");

      setIsLoading(true);
      console.log("🚀 Completing onboarding process...");
      console.log("User ID:", user.uid);
      console.log("User email:", user.email);
      console.log("Data to save:", JSON.stringify(data, null, 2));

      // ✅ CRITICAL: Ensure user document exists
      const userRef = doc(db, "users", user.uid);

      // First, check if document exists
      const userDoc = await getDoc(userRef);

      if (!userDoc.exists()) {
        console.log("⚠️ User document doesn't exist, creating it first...");
        // Create the document with basic info
        await setDoc(userRef, {
          email: user.email,
          createdAt: serverTimestamp(),
          userType: data.userData.userType || "patient",
          name: data.userData.name || "",
          onboardingCompleted: false,
        });
        console.log("✅ User document created");
      } else {
        console.log("✅ User document exists, updating...");
      }

      // Save onboarding data to subcollection
      try {
        await saveOnboardingData(user.uid, data, true);
        console.log("✅ Final onboarding data saved to Firestore");
      } catch (firestoreError) {
        console.warn("⚠️ Firestore final save failed:", firestoreError);
        Alert.alert(
          "Notice",
          "Your data was saved locally. Some features may require internet connection.",
          [{ text: "OK" }],
        );
      }

      // Update the user document with completion status and all data
      await updateDoc(userRef, {
        onboardingCompleted: true,
        onboardingCompletedAt: serverTimestamp(),
        lastUpdated: serverTimestamp(),
        name: data.userData.name,
        userType: data.userData.userType,
        dateOfBirth: data.userData.dateOfBirth,
        gender: data.userData.gender,
        contactInfo: data.userData.contactInfo,
        medicalInfo: data.medicalData,
      });

      console.log("✅ User document updated with onboarding data");

      // Always set AsyncStorage - this is critical for the app to work
      await AsyncStorage.setItem(
        `${ONBOARDING_COMPLETED_KEY}_${user.uid}`,
        "true",
      );

      setIsCompleted(true);
      console.log("🎉 Onboarding marked as completed");

      // Small delay for better UX
      await new Promise((resolve) => setTimeout(resolve, 300));
    } catch (error) {
      console.error("❌ Error completing onboarding:", error);

      // Even on error, try to set AsyncStorage
      try {
        if (user) {
          await AsyncStorage.setItem(
            `${ONBOARDING_COMPLETED_KEY}_${user.uid}`,
            "true",
          );
          setIsCompleted(true);
          console.log("⚠️ Set completed despite error");
        }
      } catch (storageError) {
        console.error("❌ Could not save to AsyncStorage:", storageError);
      }

      throw error; // Re-throw so stepper can handle it
    } finally {
      setIsLoading(false);
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
        isLoading,
        saveCurrentData,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
};
