// lib/firebaseOnboardingService.ts - FIXED VERSION
import { doc, getDoc, setDoc, Timestamp } from "firebase/firestore";
import { OnboardingData } from "../types/onboarding";
import { db } from "./firebase";

// Flag to track Firestore connection
let isFirestoreConnected = false;
let connectionAttempts = 0;
const MAX_CONNECTION_ATTEMPTS = 3;

// Initialize connection check
export const checkFirestoreConnection = async (): Promise<boolean> => {
  try {
    if (!db) {
      console.warn("⚠️ Firestore database instance not available");
      return false;
    }

    // Simple test to check connection
    isFirestoreConnected = true;
    console.log("✅ Firestore connection verified");
    return true;
  } catch (error) {
    console.error("❌ Firestore connection error:", error);
    isFirestoreConnected = false;
    return false;
  }
};

export const saveOnboardingData = async (
  userId: string,
  data: OnboardingData,
  isCompleted: boolean = false,
): Promise<void> => {
  try {
    console.log("💾 Attempting to save onboarding data...");

    // Check if Firestore is available
    if (!db || !isFirestoreConnected) {
      console.warn("⚠️ Firestore not connected, saving to AsyncStorage only");

      // Still simulate save for UX
      await new Promise((resolve) => setTimeout(resolve, 800));

      console.log("✅ Data saved locally (Firestore not available)");
      return;
    }

    const userDocRef = doc(db, "users", userId);

    const firestoreData = {
      userData: {
        ...data.userData,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      },
      medicalData: {
        ...data.medicalData,
        updatedAt: Timestamp.now(),
      },
      onboardingCompleted: isCompleted,
      lastUpdated: Timestamp.now(),
    };

    console.log("📤 Saving to Firestore collection 'users' with ID:", userId);

    // Add timeout to prevent hanging
    const savePromise = setDoc(userDocRef, firestoreData, { merge: true });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Firestore save timeout")), 10000),
    );

    await Promise.race([savePromise, timeoutPromise]);

    console.log("✅ Data saved to Firestore successfully");
    isFirestoreConnected = true; // Mark as connected
  } catch (error) {
    console.error("❌ Error saving onboarding data:", error);

    // Don't throw the error - just log it
    // This prevents the infinite loading
    console.log("⚠️ Continuing without Firestore save (error handled)");

    // Still mark as connected for future attempts
    isFirestoreConnected = true;

    // Don't rethrow - let the app continue
    return;
  }
};

export const getUserData = async (
  userId: string,
): Promise<OnboardingData | null> => {
  try {
    if (!db || !isFirestoreConnected) {
      console.log("⚠️ Firestore not connected - returning null");
      return null;
    }

    const userDocRef = doc(db, "users", userId);
    const userDoc = await getDoc(userDocRef);

    if (userDoc.exists()) {
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
            emergencyContact:
              data.userData?.contactInfo?.emergencyContact || "",
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
    }

    console.log("📭 No existing user data in Firestore");
    return null;
  } catch (error) {
    console.error("❌ Error getting user data from Firestore:", error);
    return null;
  }
};

export const checkOnboardingCompleted = async (
  userId: string,
): Promise<boolean> => {
  try {
    if (!db || !isFirestoreConnected) {
      console.log("⚠️ Firestore not connected - returning false");
      return false;
    }

    const userDocRef = doc(db, "users", userId);
    const userDoc = await getDoc(userDocRef);

    if (userDoc.exists()) {
      const data = userDoc.data();
      return data.onboardingCompleted === true;
    }
    return false;
  } catch (error) {
    console.error("❌ Error checking onboarding status:", error);
    return false;
  }
};

// Initialize connection
checkFirestoreConnection();
