// app/_layout.tsx - SIMPLIFIED WORKING VERSION
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Slot, SplashScreen, useRouter, useSegments } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { auth } from "../lib/firebase";

// Keys for AsyncStorage
const ONBOARDING_COMPLETED_KEY = "@medguard_onboarding_completed";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const checkAuthAndOnboarding = async () => {
      try {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
          console.log(
            "Auth state changed:",
            user?.email,
            "verified:",
            user?.emailVerified,
          );

          // Wait a bit to ensure auth state is stable
          await new Promise((resolve) => setTimeout(resolve, 500));

          const currentRoute = segments[0];
          console.log("Current route:", currentRoute);

          if (user) {
            // User is logged in
            if (user.emailVerified) {
              // Email is verified, check onboarding
              const onboardingCompleted = await AsyncStorage.getItem(
                `${ONBOARDING_COMPLETED_KEY}_${user.uid}`,
              );

              console.log("Onboarding completed:", onboardingCompleted);

              if (onboardingCompleted === "true") {
                // User has completed onboarding, go to tabs
                if (currentRoute !== "(tabs)") {
                  router.replace("/(tabs)");
                }
              } else {
                // User needs to complete onboarding
                if (currentRoute !== "(onboarding)") {
                  router.replace("/(onboarding)/stepper");
                }
              }
            } else {
              // Email not verified, go to verify email screen
              if (currentRoute !== "(auth)") {
                router.replace("/(auth)/verify-email");
              }
            }
          } else {
            // No user logged in, go to onboarding/welcome
            if (currentRoute !== "(auth)") {
              router.replace("/(auth)/onboarding");
            }
          }

          setIsReady(true);
          SplashScreen.hideAsync();
        });

        return unsubscribe;
      } catch (error) {
        console.error("Auth check error:", error);
        setIsReady(true);
        SplashScreen.hideAsync();
        return () => {};
      }
    };

    checkAuthAndOnboarding();
  }, [segments]);

  if (!isReady) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  return <Slot />;
}
