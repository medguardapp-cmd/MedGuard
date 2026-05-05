// app/(auth)/verify-email.tsx
import { useLocalSearchParams, useRouter } from "expo-router";
import { sendEmailVerification } from "firebase/auth";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../../hooks/useAuth";
import { auth } from "../../lib/firebase";

// --- Status Banner ---
type BannerType = "error" | "success" | "info";

function Banner({
  type,
  message,
  onDismiss,
}: {
  type: BannerType;
  message: string;
  onDismiss: () => void;
}) {
  const config = {
    error: { bg: "#fef2f2", border: "#fecaca", text: "#b91c1c", icon: "⚠️" },
    success: { bg: "#f0fdf4", border: "#bbf7d0", text: "#15803d", icon: "✓" },
    info: { bg: "#eff6ff", border: "#bfdbfe", text: "#1d4ed8", icon: "ℹ" },
  }[type];

  return (
    <View
      style={[
        bannerStyles.container,
        { backgroundColor: config.bg, borderColor: config.border },
      ]}
    >
      <Text style={[bannerStyles.icon, { color: config.text }]}>
        {config.icon}
      </Text>
      <Text style={[bannerStyles.text, { color: config.text }]}>{message}</Text>
      <TouchableOpacity
        onPress={onDismiss}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={[bannerStyles.dismiss, { color: config.text }]}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

const bannerStyles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    gap: 10,
  },
  icon: { fontSize: 14, fontWeight: "700" },
  text: { flex: 1, fontSize: 12, fontWeight: "500", lineHeight: 16 },
  dismiss: { fontSize: 13, fontWeight: "700" },
});

export default function VerifyEmailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const email = params.email as string;
  const { user } = useAuth();

  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [lastSentTime, setLastSentTime] = useState<Date | null>(null);
  const [banner, setBanner] = useState<{
    type: BannerType;
    message: string;
  } | null>(null);

  // Cooldown ticker
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // Auto-navigate if user is already verified when screen loads
  useEffect(() => {
    if (user?.emailVerified) {
      router.replace("/(tabs)");
    }
  }, []);

  const handleResend = async () => {
    if (!auth.currentUser) {
      setBanner({
        type: "error",
        message: "Session expired. Please log in again.",
      });
      return;
    }
    if (cooldown > 0) return;

    setLoading(true);
    setBanner(null);
    try {
      await sendEmailVerification(auth.currentUser);
      const now = new Date();
      setLastSentTime(now);
      setCooldown(60);
      setBanner({
        type: "success",
        message: "Verification email sent! Check your inbox and spam folder.",
      });
    } catch (error: any) {
      const code = error?.code ?? "";
      const msg =
        code === "auth/too-many-requests"
          ? "Too many requests. Please wait a few minutes before trying again."
          : "Failed to send email. Please try again.";
      setBanner({ type: "error", message: msg });
    } finally {
      setLoading(false);
    }
  };

  const handleCheckVerification = async () => {
    if (!auth.currentUser) {
      setBanner({
        type: "error",
        message: "Session expired. Please log in again.",
      });
      return;
    }

    setChecking(true);
    setBanner(null);
    try {
      await auth.currentUser.reload();
      const refreshed = auth.currentUser;

      if (refreshed?.emailVerified) {
        setBanner({
          type: "success",
          message: "Email verified! Taking you to the app…",
        });
        setTimeout(() => router.replace("/(tabs)"), 1200);
      } else {
        setBanner({
          type: "info",
          message:
            "Not verified yet. Click the link in your email then tap this button again.",
        });
      }
    } catch {
      setBanner({
        type: "error",
        message: "Could not check status. Check your connection and try again.",
      });
    } finally {
      setChecking(false);
    }
  };

  const displayEmail = email || user?.email || "";

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Illustration */}
        <View style={styles.illustrationContainer}>
          <View style={styles.outerRing}>
            <View style={styles.innerRing}>
              <Text style={styles.illustrationIcon}>✉️</Text>
            </View>
          </View>
          <View style={[styles.dot, styles.dotTopLeft]} />
          <View style={[styles.dot, styles.dotTopRight]} />
          <View style={[styles.dot, styles.dotBottomLeft]} />
        </View>

        {/* Heading */}
        <Text style={styles.title}>Check your inbox</Text>
        <Text style={styles.subtitle}>We sent a verification link to</Text>
        <View style={styles.emailPill}>
          <Text style={styles.emailText} numberOfLines={1}>
            {displayEmail}
          </Text>
        </View>
        {lastSentTime && (
          <Text style={styles.sentTime}>
            Last sent at{" "}
            {lastSentTime.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>
        )}

        {/* Banner */}
        {banner && (
          <Banner
            type={banner.type}
            message={banner.message}
            onDismiss={() => setBanner(null)}
          />
        )}

        {/* Steps */}
        <View style={styles.stepsCard}>
          <Text style={styles.stepsTitle}>What to do next</Text>
          {[
            { n: "1", text: "Open the email from MedGuard" },
            { n: "2", text: 'Click "Verify my email"' },
            { n: "3", text: "Come back and tap the button below" },
          ].map((s) => (
            <View key={s.n} style={styles.step}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepNumber}>{s.n}</Text>
              </View>
              <Text style={styles.stepText}>{s.text}</Text>
            </View>
          ))}
        </View>

        {/* Primary CTA */}
        <TouchableOpacity
          style={[styles.primaryButton, checking && styles.buttonDisabled]}
          onPress={handleCheckVerification}
          disabled={checking}
          activeOpacity={0.85}
        >
          {checking ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={styles.primaryButtonText}>
              I&apos;ve Verified My Email
            </Text>
          )}
        </TouchableOpacity>

        {/* Resend */}
        <TouchableOpacity
          style={[
            styles.resendButton,
            (loading || cooldown > 0) && styles.buttonDisabled,
          ]}
          onPress={handleResend}
          disabled={loading || cooldown > 0}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator color="#4A70A9" size="small" />
          ) : (
            <Text style={styles.resendButtonText}>
              {cooldown > 0
                ? `Resend in ${cooldown}s`
                : "Resend Verification Email"}
            </Text>
          )}
        </TouchableOpacity>

        {/* Back to login */}
        <TouchableOpacity
          style={styles.backLink}
          onPress={() => router.push("/(auth)/login")}
        >
          <Text style={styles.backLinkText}>← Back to Login</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: {
    flex: 1,
    padding: 20,
    justifyContent: "center",
    alignItems: "center",
  },

  // Illustration
  illustrationContainer: {
    width: 120,
    height: 120,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  outerRing: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: "#eff6ff",
    justifyContent: "center",
    alignItems: "center",
  },
  innerRing: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#dbeafe",
    justifyContent: "center",
    alignItems: "center",
  },
  illustrationIcon: { fontSize: 34 },
  dot: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#bfdbfe",
  },
  dotTopLeft: { top: 10, left: 8 },
  dotTopRight: {
    top: 16,
    right: 6,
    width: 6,
    height: 6,
    backgroundColor: "#93c5fd",
  },
  dotBottomLeft: {
    bottom: 12,
    left: 16,
    width: 5,
    height: 5,
    backgroundColor: "#60a5fa",
  },

  // Text
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#111827",
    textAlign: "center",
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
    marginBottom: 8,
  },

  // Email pill
  emailPill: {
    backgroundColor: "#eff6ff",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginBottom: 4,
    maxWidth: "90%",
  },
  emailText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#4A70A9",
    textAlign: "center",
  },
  sentTime: { fontSize: 11, color: "#9ca3af", marginBottom: 8 },

  // Steps card
  stepsCard: {
    width: "100%",
    backgroundColor: "#f9fafb",
    borderRadius: 14,
    padding: 16,
    marginTop: 20,
    marginBottom: 30,
    borderWidth: 1,
    borderColor: "#f3f4f6",
  },
  stepsTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#374151",
    marginBottom: 10,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  step: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    gap: 10,
  },
  stepBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#dbeafe",
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },
  stepNumber: { fontSize: 11, fontWeight: "700", color: "#4A70A9" },
  stepText: { fontSize: 13, color: "#374151", flex: 1, lineHeight: 18 },

  // Buttons
  primaryButton: {
    width: "100%",
    backgroundColor: "#4A70A9",
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 10,
    shadowColor: "#4A70A9",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryButtonText: {
    color: "white",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.3,
  },

  resendButton: {
    width: "100%",
    backgroundColor: "#fff",
    padding: 13,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#e5e7eb",
    marginBottom: 16,
  },
  resendButtonText: { color: "#4A70A9", fontSize: 14, fontWeight: "600" },

  buttonDisabled: { opacity: 0.5, shadowOpacity: 0 },

  // Back link
  backLink: { padding: 6 },
  backLinkText: { fontSize: 13, color: "#9ca3af", fontWeight: "500" },
});
