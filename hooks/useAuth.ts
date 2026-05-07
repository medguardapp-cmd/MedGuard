// hooks/useAuth.ts
import {
  User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { auth, db } from "../lib/firebase";

export type UserRole = "patient" | "caregiver";

const logAuthEvent = (event: string, data?: any) => {
  const timestamp = new Date().toISOString();
  const logData = data ? JSON.stringify(data, null, 2) : "";
  console.log(
    `🔐 [AUTH] ${timestamp} - ${event}`,
    logData ? `\n${logData}` : "",
  );
};

const logAuthError = (event: string, error: any) => {
  const timestamp = new Date().toISOString();
  console.error(`❌ [AUTH] ${timestamp} - ${event}:`, error);
  console.error("Error details:", {
    code: error?.code,
    message: error?.message,
    name: error?.name,
  });
};

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null); // ✅ Added
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    logAuthEvent("Auth hook initialized");

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      logAuthEvent("Auth state changed", {
        userExists: !!firebaseUser,
        userId: firebaseUser?.uid,
        email: firebaseUser?.email,
        emailVerified: firebaseUser?.emailVerified,
      });

      setUser(firebaseUser);

      // ✅ Fetch role from Firestore whenever auth state changes
      if (firebaseUser) {
        try {
          const snap = await getDoc(doc(db, "users", firebaseUser.uid));
          const data = snap.data();
          // userType is stored as "patient" | "caregiver" in Firestore
          setUserRole((data?.userType as UserRole) ?? "patient");
        } catch (err) {
          console.error("Failed to fetch userRole:", err);
          setUserRole("patient"); // safe fallback
        }
      } else {
        setUserRole(null);
      }

      setLoading(false);
    });

    return () => {
      logAuthEvent("Auth hook cleanup");
      unsubscribe();
    };
  }, []);

  const signUp = async (email: string, password: string) => {
    logAuthEvent("Signup attempt", { email, passwordLength: password.length });

    try {
      logAuthEvent("Creating user with Firebase...");
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        email,
        password,
      );

      logAuthEvent("User created successfully", {
        userId: userCredential.user.uid,
        email: userCredential.user.email,
        emailVerified: userCredential.user.emailVerified,
      });

      logAuthEvent("Creating Firestore user document...");
      const userRef = doc(db, "users", userCredential.user.uid);
      await setDoc(userRef, {
        email: email,
        createdAt: serverTimestamp(),
        onboardingCompleted: false,
        userType: "patient",
        emailVerified: false,
      });
      logAuthEvent("Firestore user document created successfully");

      logAuthEvent("Sending email verification...");
      await sendEmailVerification(userCredential.user);
      logAuthEvent("Email verification sent successfully");

      return {
        success: true,
        user: userCredential.user,
        message: "Verification email sent successfully",
      };
    } catch (error: any) {
      logAuthError("Signup failed", error);
      return { success: false, error: error.message, errorCode: error.code };
    }
  };

  const signIn = async (email: string, password: string) => {
    logAuthEvent("Login attempt", { email });

    try {
      const userCredential = await signInWithEmailAndPassword(
        auth,
        email,
        password,
      );

      logAuthEvent("Login successful", {
        userId: userCredential.user.uid,
        email: userCredential.user.email,
        emailVerified: userCredential.user.emailVerified,
      });

      return {
        success: true,
        user: userCredential.user,
        emailVerified: userCredential.user.emailVerified,
      };
    } catch (error: any) {
      logAuthError("Login failed", error);
      return { success: false, error: error.message, errorCode: error.code };
    }
  };

  const logOut = async () => {
    logAuthEvent("Logout attempt", { userId: user?.uid });

    try {
      await signOut(auth);
      logAuthEvent("Logout successful");
      return { success: true };
    } catch (error: any) {
      logAuthError("Logout failed", error);
      return { success: false, error: error.message };
    }
  };

  const resetPassword = async (email: string) => {
    logAuthEvent("Password reset request", { email });

    try {
      await sendPasswordResetEmail(auth, email);
      logAuthEvent("Password reset email sent");
      return {
        success: true,
        message: "Password reset email sent successfully",
      };
    } catch (error: any) {
      logAuthError("Password reset failed", error);
      return { success: false, error: error.message };
    }
  };

  return {
    user,
    userRole, // ✅ Now exported
    loading,
    signUp,
    signIn,
    logOut,
    resetPassword,
  };
};
