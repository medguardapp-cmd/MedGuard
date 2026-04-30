// lib/firebaseOnboardingService.ts
import { doc, getDoc, setDoc, Timestamp } from "firebase/firestore";
import { OnboardingData } from "../types/onboarding";
import { db } from "./firebase";

export const saveOnboardingData = async (
  userId: string,
  data: OnboardingData,
  isCompleted: boolean = false,
): Promise<void> => {
  if (!userId) throw new Error("No user ID provided");
  if (!db) throw new Error("Firestore not initialized");

  console.log("💾 Saving onboarding data to Firestore...", {
    userId,
    isCompleted,
  });

  const userDocRef = doc(db, "users", userId);

  const firestoreData = {
    userData: {
      ...data.userData,
      updatedAt: Timestamp.now(),
    },
    medicalData: {
      ...data.medicalData,
      updatedAt: Timestamp.now(),
    },
    onboardingCompleted: isCompleted,
    lastUpdated: Timestamp.now(),
  };

  await setDoc(userDocRef, firestoreData, { merge: true });
  console.log("✅ Onboarding data saved successfully");
};

export const getUserData = async (
  userId: string,
): Promise<OnboardingData | null> => {
  if (!userId || !db) return null;

  try {
    const userDocRef = doc(db, "users", userId);
    const userDoc = await getDoc(userDocRef);

    if (!userDoc.exists()) {
      console.log("📭 No existing user data in Firestore");
      return null;
    }

    const data = userDoc.data();
    console.log("📥 Found existing user data in Firestore");
    return {
      userData: {
        userType: data.userData?.userType || "patient",
        name: data.userData?.name || "",
        dateOfBirth: data.userData?.dateOfBirth || "",
        gender: data.userData?.gender || "",
        contactInfo: {
          phone: data.userData?.contactInfo?.phone || "",
          address: data.userData?.contactInfo?.address || "",
          emergencyContact: data.userData?.contactInfo?.emergencyContact || "",
        },
      },
      medicalData: {
        conditions: data.medicalData?.conditions || [],
        allergies: data.medicalData?.allergies || [],
        medications: data.medicalData?.medications || [],
        bloodType: data.medicalData?.bloodType || "",
        height: data.medicalData?.height || "",
        weight: data.medicalData?.weight || "",
        notes: data.medicalData?.notes || "",
      },
    };
  } catch (error) {
    console.error("❌ Error getting user data:", error);
    return null;
  }
};

export const checkOnboardingCompleted = async (
  userId: string,
): Promise<boolean> => {
  if (!userId || !db) return false;

  try {
    const userDoc = await getDoc(doc(db, "users", userId));
    if (!userDoc.exists()) return false;
    return userDoc.data().onboardingCompleted === true;
  } catch (error) {
    console.error("❌ Error checking onboarding status:", error);
    return false;
  }
};
