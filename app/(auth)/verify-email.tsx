// app/(auth)/verify-email.tsx
import { useLocalSearchParams, useRouter } from "expo-router";
import { sendEmailVerification } from "firebase/auth";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
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
    padding: 14,
    marginBottom: 16,
    gap: 10,
  },
  icon: { fontSize: 15, fontWeight: "700" },
  text: { flex: 1, fontSize: 13, fontWeight: "500", lineHeight: 18 },
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
      // Force reload the user to get the latest emailVerified status
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
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Illustration */}
        <View style={styles.illustrationContainer}>
          <View style={styles.outerRing}>
            <View style={styles.innerRing}>
              <Text style={styles.illustrationIcon}>✉️</Text>
            </View>
          </View>
          {/* Decorative dots */}
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
        <View style={styles.bannerArea}>
          {banner && (
            <Banner
              type={banner.type}
              message={banner.message}
              onDismiss={() => setBanner(null)}
            />
          )}
        </View>

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
            <ActivityIndicator color="#2563eb" size="small" />
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
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  scrollContent: {
    flexGrow: 1,
    padding: 24,
    paddingBottom: 48,
    alignItems: "center",
  },

  // Illustration
  illustrationContainer: {
    width: 160,
    height: 160,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 24,
    marginBottom: 32,
  },
  outerRing: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: "#eff6ff",
    justifyContent: "center",
    alignItems: "center",
  },
  innerRing: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "#dbeafe",
    justifyContent: "center",
    alignItems: "center",
  },
  illustrationIcon: { fontSize: 44 },
  dot: {
    position: "absolute",
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#bfdbfe",
  },
  dotTopLeft: { top: 12, left: 10 },
  dotTopRight: {
    top: 20,
    right: 8,
    width: 7,
    height: 7,
    backgroundColor: "#93c5fd",
  },
  dotBottomLeft: {
    bottom: 16,
    left: 20,
    width: 6,
    height: 6,
    backgroundColor: "#60a5fa",
  },

  // Text
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: "#111827",
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: "#6b7280",
    textAlign: "center",
    marginBottom: 12,
  },

  // Email pill
  emailPill: {
    backgroundColor: "#eff6ff",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginBottom: 8,
    maxWidth: "90%",
  },
  emailText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#2563eb",
    textAlign: "center",
  },
  sentTime: { fontSize: 12, color: "#9ca3af", marginBottom: 4 },

  // Banner
  bannerArea: { width: "100%", marginTop: 8 },

  // Steps card
  stepsCard: {
    width: "100%",
    backgroundColor: "#f9fafb",
    borderRadius: 16,
    padding: 20,
    marginTop: 8,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: "#f3f4f6",
  },
  stepsTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#374151",
    marginBottom: 14,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  step: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    gap: 12,
  },
  stepBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#dbeafe",
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },
  stepNumber: { fontSize: 12, fontWeight: "700", color: "#2563eb" },
  stepText: { fontSize: 14, color: "#374151", flex: 1, lineHeight: 20 },

  // Buttons
  primaryButton: {
    width: "100%",
    backgroundColor: "#2563eb",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 12,
    shadowColor: "#2563eb",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.3,
  },

  resendButton: {
    width: "100%",
    backgroundColor: "#fff",
    padding: 15,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#e5e7eb",
    marginBottom: 24,
  },
  resendButtonText: { color: "#2563eb", fontSize: 15, fontWeight: "600" },

  buttonDisabled: { opacity: 0.5, shadowOpacity: 0 },

  // Back link
  backLink: { padding: 8 },
  backLinkText: { fontSize: 14, color: "#9ca3af", fontWeight: "500" },
});
