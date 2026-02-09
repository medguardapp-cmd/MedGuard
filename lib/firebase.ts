// lib/firebase.ts
import { initializeApp } from "firebase/app";
import {
    getAuth
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Auth
const auth = getAuth(app);

// Set persistence for React Native
// Note: For React Native, we need to use a different approach
// We'll handle persistence manually with AsyncStorage

export { auth };
export const db = getFirestore(app);

// Helper function to manually handle auth persistence
export const setAuthPersistence = async () => {
  try {
    // For React Native, we'll use AsyncStorage manually
    // Firebase v9+ has built-in React Native support but persistence works differently
    return Promise.resolve();
  } catch (error) {
    console.error("Auth persistence error:", error);
    return Promise.reject(error);
  }
};
