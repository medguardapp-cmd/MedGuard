// app/(auth)/verify-email.tsx
import { useLocalSearchParams, useRouter } from "expo-router";
import { sendEmailVerification } from "firebase/auth";
import React, { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { useAuth } from "../../hooks/useAuth";
import { auth } from "../../lib/firebase";

// Logging for verify email screen
const logVerifyEvent = (event: string, data?: any) => {
  const timestamp = new Date().toISOString();
  console.log(`📧 [VERIFY] ${timestamp} - ${event}`, data || "");
};

export default function VerifyEmailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const email = params.email as string;
  const { user } = useAuth();

  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [lastSentTime, setLastSentTime] = useState<Date | null>(null);

  const handleResendVerification = async () => {
    if (!auth.currentUser) {
      logVerifyEvent("No current user found");
      Alert.alert("Error", "User not found. Please try logging in again.");
      return;
    }

    if (cooldown > 0) {
      logVerifyEvent("Resend blocked - cooldown active", { cooldown });
      return;
    }

    logVerifyEvent("Resend verification attempt", {
      email: auth.currentUser.email,
      userId: auth.currentUser.uid,
    });

    setLoading(true);
    try {
      logVerifyEvent("Sending verification email via Firebase...");
      await sendEmailVerification(auth.currentUser);

      const sentTime = new Date();
      setLastSentTime(sentTime);

      logVerifyEvent("Verification email sent successfully", {
        email: auth.currentUser.email,
        userId: auth.currentUser.uid,
        sentTime: sentTime.toISOString(),
        timestamp: Date.now(),
      });

      Alert.alert(
        "Email Sent!",
        "Verification email has been sent successfully. Please check your inbox and spam folder.",
        [{ text: "OK" }],
      );

      setCooldown(60); // 60 second cooldown
      logVerifyEvent("Cooldown activated", { seconds: 60 });
    } catch (error: any) {
      logVerifyEvent("Failed to send verification email", {
        error: error.message,
        errorCode: error.code,
        email: auth.currentUser.email,
      });

      Alert.alert(
        "Sending Failed",
        `Failed to send verification email: ${error.message || "Unknown error"}`,
        [{ text: "OK" }],
      );
    } finally {
      setLoading(false);
    }
  };

  const handleCheckVerification = () => {
    logVerifyEvent("Checking email verification status", {
      hasUser: !!user,
      email: user?.email,
      emailVerified: user?.emailVerified,
    });

    if (user?.emailVerified) {
      logVerifyEvent("Email verified successfully!", {
        userId: user.uid,
        email: user.email,
      });

      Alert.alert("Success!", "Your email has been verified successfully.", [
        {
          text: "Continue to App",
          onPress: () => {
            logVerifyEvent("Navigating to main app");
            router.replace("/(tabs)");
          },
        },
      ]);
    } else {
      logVerifyEvent("Email not yet verified");
      Alert.alert(
        "Not Verified",
        "Email is not verified yet. Please check your inbox and click the verification link.",
        [
          {
            text: "Resend Email",
            onPress: handleResendVerification,
          },
          { text: "OK" },
        ],
      );
    }
  };

  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => {
        setCooldown(cooldown - 1);
        if (cooldown === 1) {
          logVerifyEvent("Cooldown finished");
        }
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldown]);

  useEffect(() => {
    // Log when screen loads
    logVerifyEvent("Verify email screen loaded", {
      emailParam: email,
      hasUser: !!user,
      userEmail: user?.email,
      userVerified: user?.emailVerified,
    });
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.content}>
          <View style={styles.iconContainer}>
            <Text style={styles.icon}>📧</Text>
          </View>

          <Text style={styles.title}>Verify Your Email</Text>

          <Text style={styles.message}>Weve sent a verification email to:</Text>

          <View style={styles.emailContainer}>
            <Text style={styles.email}>{email || user?.email}</Text>
            {lastSentTime && (
              <Text style={styles.sentTime}>
                Last sent: {lastSentTime.toLocaleTimeString()}
              </Text>
            )}
          </View>

          <Text style={styles.instructions}>
            Please check your inbox and click the verification link to activate
            your account. If you dont see the email, check your spam folder.
          </Text>

          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={[
                styles.resendButton,
                (loading || cooldown > 0) && styles.resendButtonDisabled,
              ]}
              onPress={handleResendVerification}
              disabled={loading || cooldown > 0}
            >
              {loading ? (
                <ActivityIndicator color="#3b82f6" />
              ) : (
                <Text style={styles.resendButtonText}>
                  {cooldown > 0
                    ? `Resend available in ${cooldown}s`
                    : "Resend Verification Email"}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.continueButton}
              onPress={handleCheckVerification}
            >
              <Text style={styles.continueButtonText}>
                Ive Verified My Email
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.checkStatusButton}
              onPress={handleCheckVerification}
            >
              <Text style={styles.checkStatusButtonText}>
                Check Verification Status
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.infoContainer}>
            <Text style={styles.infoTitle}>Troubleshooting:</Text>
            <Text style={styles.infoText}>• Check spam/junk folder</Text>
            <Text style={styles.infoText}>
              • Ensure email address is correct
            </Text>
            <Text style={styles.infoText}>
              • Try resending if not received within 5 minutes
            </Text>
            <Text style={styles.infoText}>
              • Contact support if issues persist
            </Text>
          </View>

          <TouchableOpacity
            style={styles.loginLink}
            onPress={() => {
              logVerifyEvent("Navigating back to login");
              router.push("/(auth)/login");
            }}
          >
            <Text style={styles.loginLinkText}>Back to Login</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  iconContainer: {
    backgroundColor: "#dbeafe",
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 32,
  },
  icon: {
    fontSize: 50,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#1f2937",
    marginBottom: 16,
    textAlign: "center",
  },
  message: {
    fontSize: 16,
    color: "#6b7280",
    textAlign: "center",
    marginBottom: 8,
  },
  emailContainer: {
    alignItems: "center",
    marginBottom: 24,
  },
  email: {
    fontSize: 18,
    fontWeight: "600",
    color: "#3b82f6",
    textAlign: "center",
    marginBottom: 4,
  },
  sentTime: {
    fontSize: 12,
    color: "#94a3b8",
    textAlign: "center",
  },
  instructions: {
    fontSize: 16,
    color: "#6b7280",
    textAlign: "center",
    marginBottom: 40,
    lineHeight: 24,
    paddingHorizontal: 20,
  },
  buttonContainer: {
    width: "100%",
    gap: 12,
    marginBottom: 32,
  },
  resendButton: {
    backgroundColor: "#f3f4f6",
    padding: 18,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#d1d5db",
  },
  resendButtonDisabled: {
    opacity: 0.6,
  },
  resendButtonText: {
    color: "#374151",
    fontSize: 16,
    fontWeight: "500",
  },
  continueButton: {
    backgroundColor: "#3b82f6",
    padding: 18,
    borderRadius: 12,
    alignItems: "center",
  },
  continueButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  checkStatusButton: {
    backgroundColor: "#e0e7ff",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#c7d2fe",
  },
  checkStatusButtonText: {
    color: "#4f46e5",
    fontSize: 14,
    fontWeight: "500",
  },
  infoContainer: {
    backgroundColor: "#f8fafc",
    padding: 20,
    borderRadius: 12,
    marginBottom: 32,
    width: "100%",
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1e293b",
    marginBottom: 12,
  },
  infoText: {
    fontSize: 14,
    color: "#475569",
    marginBottom: 6,
    lineHeight: 20,
  },
  loginLink: {
    padding: 12,
  },
  loginLinkText: {
    color: "#6b7280",
    fontSize: 16,
    textDecorationLine: "underline",
  },
});
