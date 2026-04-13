// components/ProtectedRoute.tsx
import { useRouter } from "expo-router";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import Colors from "../constants/colors";
import { useOnboarding } from "../contexts/OnboardingContext";
import { useAuth } from "../hooks/useAuth";
import { db } from "../lib/firebase";

interface ProtectedRouteProps {
  children: React.ReactNode;
  // Allow specific pages to be accessible to caregivers with no patients
  allowForCaregiverWithNoPatients?: boolean;
}

export default function ProtectedRoute({
  children,
  allowForCaregiverWithNoPatients = false,
}: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const { data } = useOnboarding();
  const router = useRouter();

  const [hasPatients, setHasPatients] = useState<boolean | null>(null);
  const [checkingPatients, setCheckingPatients] = useState(true);

  // Check if caregiver has any approved patients
  useEffect(() => {
    if (!user || data.userData.userType !== "caregiver") {
      setCheckingPatients(false);
      return;
    }

    const q = query(
      collection(db, "caregiver_connections"),
      where("caregiverId", "==", user.uid),
      where("status", "==", "approved"),
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setHasPatients(snapshot.docs.length > 0);
      setCheckingPatients(false);
    });

    return unsubscribe;
  }, [user, data.userData.userType]);

  // Handle routing
  useEffect(() => {
    if (loading || checkingPatients) return;

    // Not authenticated or email not verified
    if (!user || !user.emailVerified) {
      router.replace("/(auth)/login");
      return;
    }

    // Caregiver with no patients trying to access restricted page
    if (
      data.userData.userType === "caregiver" &&
      !hasPatients &&
      !allowForCaregiverWithNoPatients
    ) {
      router.replace("/(tabs)/caregiver");
      return;
    }
  }, [
    user,
    loading,
    data.userData.userType,
    hasPatients,
    checkingPatients,
    allowForCaregiverWithNoPatients,
  ]);

  // Show loading states
  if (loading || checkingPatients) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  // Not authenticated
  if (!user || !user.emailVerified) {
    return null;
  }

  // Caregiver with no patients trying to access restricted page
  if (
    data.userData.userType === "caregiver" &&
    !hasPatients &&
    !allowForCaregiverWithNoPatients
  ) {
    return null;
  }

  return <>{children}</>;
}
