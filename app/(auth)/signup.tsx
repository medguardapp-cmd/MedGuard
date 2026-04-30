// app/(auth)/signup.tsx
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../../hooks/useAuth";
// --- Firebase error mapper ---
const mapFirebaseError = (raw: string): string => {
  const code = raw?.match(/\(([^)]+)\)/)?.[1] ?? raw ?? "";
  const map: Record<string, string> = {
    "auth/email-already-in-use": "An account with this email already exists.",
    "auth/invalid-email": "That email address isn't valid.",
    "auth/weak-password": "Password is too weak. Use at least 6 characters.",
    "auth/network-request-failed":
      "Network error. Check your connection and try again.",
    "auth/operation-not-allowed":
      "Sign-up is currently unavailable. Contact support.",
    "auth/too-many-requests":
      "Too many attempts. Please wait a moment and try again.",
  };
  return map[code] ?? "Something went wrong. Please try again.";
};

// --- Validation helpers ---
const validateEmail = (email: string): string | null => {
  if (!email.trim()) return "Email is required";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
    return "Enter a valid email address";
  return null;
};

const validatePassword = (password: string): string | null => {
  if (!password) return "Password is required";
  if (password.length < 6) return "Password must be at least 6 characters";
  return null;
};

const validateConfirm = (password: string, confirm: string): string | null => {
  if (!confirm) return "Please confirm your password";
  if (confirm !== password) return "Passwords do not match";
  return null;
};

// --- Eye Icons (pure React Native) ---
function EyeIcon() {
  return (
    <View style={eyeStyles.container}>
      <View style={eyeStyles.outer} />
      <View style={eyeStyles.pupil} />
    </View>
  );
}

function EyeOffIcon() {
  return (
    <View style={eyeStyles.container}>
      <View style={[eyeStyles.outer, eyeStyles.outerFaded]} />
      <View style={eyeStyles.slash} />
    </View>
  );
}

const eyeStyles = StyleSheet.create({
  container: {
    width: 22,
    height: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  outer: {
    width: 20,
    height: 12,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#9ca3af",
    position: "absolute",
  },
  outerFaded: { borderColor: "#c4c9d4" },
  pupil: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#9ca3af",
    position: "absolute",
  },
  slash: {
    position: "absolute",
    width: 2,
    height: 22,
    borderRadius: 1,
    backgroundColor: "#9ca3af",
    transform: [{ rotate: "45deg" }],
  },
});

// --- Error Banner ---
function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <View style={bannerStyles.container}>
      <Text style={bannerStyles.icon}>⚠️</Text>
      <Text style={bannerStyles.text}>{message}</Text>
      <TouchableOpacity
        onPress={onDismiss}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={bannerStyles.dismiss}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

const bannerStyles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca",
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
    gap: 10,
  },
  icon: { fontSize: 16 },
  text: {
    flex: 1,
    fontSize: 13,
    color: "#b91c1c",
    fontWeight: "500",
    lineHeight: 18,
  },
  dismiss: { fontSize: 14, color: "#ef4444", fontWeight: "700" },
});

// --- Field component ---
interface FieldProps {
  label: string;
  hint?: string;
  value: string;
  onChange: (text: string) => void;
  error: string | null;
  touched: boolean;
  placeholder: string;
  keyboardType?: "default" | "email-address";
  autoCapitalize?: "none" | "sentences";
  secure?: boolean;
  showToggle?: boolean;
  showPassword?: boolean;
  onTogglePassword?: () => void;
  onBlur: () => void;
  onSubmit?: () => void;
  editable?: boolean;
}

function Field({
  label,
  hint,
  value,
  onChange,
  error,
  touched,
  placeholder,
  keyboardType = "default",
  autoCapitalize = "sentences",
  secure = false,
  showToggle = false,
  showPassword = false,
  onTogglePassword,
  onBlur,
  onSubmit,
  editable = true,
}: FieldProps) {
  const hasError = touched && !!error;
  return (
    <View style={fieldStyles.container}>
      <Text style={fieldStyles.label}>{label}</Text>
      <View
        style={[
          fieldStyles.inputWrapper,
          hasError && fieldStyles.inputWrapperError,
        ]}
      >
        <TextInput
          style={fieldStyles.input}
          placeholder={placeholder}
          placeholderTextColor="#9ca3af"
          value={value}
          onChangeText={onChange}
          onBlur={onBlur}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          secureTextEntry={secure && !showPassword}
          autoCorrect={false}
          editable={editable}
          onSubmitEditing={onSubmit}
          returnKeyType={onSubmit ? "done" : "next"}
        />
        {showToggle && (
          <TouchableOpacity
            style={fieldStyles.eyeButton}
            onPress={onTogglePassword}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {showPassword ? <EyeOffIcon /> : <EyeIcon />}
          </TouchableOpacity>
        )}
      </View>
      {hasError ? (
        <Text style={fieldStyles.errorText}>{error}</Text>
      ) : hint ? (
        <Text style={fieldStyles.hintText}>{hint}</Text>
      ) : null}
    </View>
  );
}

const fieldStyles = StyleSheet.create({
  container: { marginBottom: 20 },
  label: { fontSize: 14, fontWeight: "600", color: "#374151", marginBottom: 6 },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    backgroundColor: "#f9fafb",
    overflow: "hidden",
  },
  inputWrapperError: { borderColor: "#ef4444", backgroundColor: "#fff5f5" },
  input: { flex: 1, padding: 14, fontSize: 15, color: "#111827" },
  eyeButton: { paddingHorizontal: 14, paddingVertical: 4 },
  errorText: {
    marginTop: 5,
    fontSize: 12,
    color: "#ef4444",
    fontWeight: "500",
  },
  hintText: { marginTop: 5, fontSize: 12, color: "#9ca3af" },
});

// --- Password strength indicator ---
function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;
  const len = password.length;
  const hasUpper = /[A-Z]/.test(password);
  const hasNum = /[0-9]/.test(password);
  const hasSpecial = /[^a-zA-Z0-9]/.test(password);
  const score =
    (len >= 8 ? 1 : 0) +
    (hasUpper ? 1 : 0) +
    (hasNum ? 1 : 0) +
    (hasSpecial ? 1 : 0);

  const levels = [
    { label: "Weak", color: "#ef4444" },
    { label: "Fair", color: "#f97316" },
    { label: "Good", color: "#eab308" },
    { label: "Strong", color: "#22c55e" },
  ];
  const level = levels[Math.min(score, 3)];

  return (
    <View style={strengthStyles.container}>
      <View style={strengthStyles.bars}>
        {levels.map((l, i) => (
          <View
            key={i}
            style={[
              strengthStyles.bar,
              { backgroundColor: i <= score - 1 ? level.color : "#e5e7eb" },
            ]}
          />
        ))}
      </View>
      <Text style={[strengthStyles.label, { color: level.color }]}>
        {level.label}
      </Text>
    </View>
  );
}

const strengthStyles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    gap: 8,
  },
  bars: { flex: 1, flexDirection: "row", gap: 4 },
  bar: { flex: 1, height: 3, borderRadius: 2 },
  label: { fontSize: 11, fontWeight: "600", width: 40, textAlign: "right" },
});

// --- Main screen ---
export default function SignupScreen() {
  const router = useRouter();
  const { signUp } = useAuth();

  const [formData, setFormData] = useState({
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [touched, setTouched] = useState({
    email: false,
    password: false,
    confirmPassword: false,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [signupError, setSignupError] = useState<string | null>(null);

  const errors = {
    email: validateEmail(formData.email),
    password: validatePassword(formData.password),
    confirmPassword: validateConfirm(
      formData.password,
      formData.confirmPassword,
    ),
  };

  const isFormValid =
    !errors.email && !errors.password && !errors.confirmPassword;

  const touch = (field: keyof typeof touched) =>
    setTouched((prev) => ({ ...prev, [field]: true }));

  const touchAll = () =>
    setTouched({ email: true, password: true, confirmPassword: true });

  const handleSignup = async () => {
    touchAll();
    setSignupError(null);
    if (!isFormValid) return;

    setLoading(true);
    const result = await signUp(formData.email.trim(), formData.password);
    setLoading(false);

    if (result.success) {
      router.push({
        pathname: "/(auth)/verify-email",
        params: { email: formData.email.trim() },
      });
    } else {
      setSignupError(mapFirebaseError(result.error ?? ""));
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.container}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => router.back()}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.backButtonText}>←</Text>
            </TouchableOpacity>
            <View style={styles.iconBadge}>
              <Image
                source={require("../../assets/images/medguard-bg.png")}
                style={{ width: 36, height: 36 }}
                resizeMode="contain"
              />
            </View>
            <Text style={styles.title}>Create Account</Text>
            <Text style={styles.subtitle}>
              Secure your health with MedGuard
            </Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            {signupError && (
              <ErrorBanner
                message={signupError}
                onDismiss={() => setSignupError(null)}
              />
            )}

            <Field
              label="Email Address"
              value={formData.email}
              onChange={(t) => {
                setFormData({ ...formData, email: t });
                setSignupError(null);
              }}
              onBlur={() => touch("email")}
              error={errors.email}
              touched={touched.email}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              editable={!loading}
            />

            <Field
              label="Password"
              hint="Minimum 6 characters"
              value={formData.password}
              onChange={(t) => {
                setFormData({ ...formData, password: t });
                setSignupError(null);
              }}
              onBlur={() => touch("password")}
              error={errors.password}
              touched={touched.password}
              placeholder="Create a password"
              secure
              showToggle
              showPassword={showPassword}
              onTogglePassword={() => setShowPassword((v) => !v)}
              editable={!loading}
            />
            <View style={{ marginTop: -12, marginBottom: 20 }}>
              <PasswordStrength password={formData.password} />
            </View>

            <Field
              label="Confirm Password"
              value={formData.confirmPassword}
              onChange={(t) => {
                setFormData({ ...formData, confirmPassword: t });
                setSignupError(null);
              }}
              onBlur={() => touch("confirmPassword")}
              error={errors.confirmPassword}
              touched={touched.confirmPassword}
              placeholder="Re-enter your password"
              secure
              showToggle
              showPassword={showConfirm}
              onTogglePassword={() => setShowConfirm((v) => !v)}
              editable={!loading}
              onSubmit={handleSignup}
            />

            <TouchableOpacity
              style={[
                styles.signupButton,
                (!isFormValid || loading) && styles.signupButtonDisabled,
              ]}
              onPress={handleSignup}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={styles.signupButtonText}>Create Account</Text>
              )}
            </TouchableOpacity>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            <View style={styles.loginContainer}>
              <Text style={styles.loginText}>Already have an account?</Text>
              <TouchableOpacity
                onPress={() => router.push("/(auth)/login")}
                disabled={loading}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
              >
                <Text style={styles.loginLink}> Sign In</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  scrollContent: { flexGrow: 1, padding: 24, paddingBottom: 40 },

  // Header
  header: { marginTop: 16, marginBottom: 36 },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#f3f4f6",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 32,
  },
  backButtonText: { fontSize: 20, color: "#374151" },
  iconBadge: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: "#eff6ff",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  iconText: { fontSize: 28 },
  title: { fontSize: 28, fontWeight: "700", color: "#111827", marginBottom: 6 },
  subtitle: { fontSize: 15, color: "#6b7280", lineHeight: 22 },

  // Form
  form: { flex: 1 },

  // Button
  signupButton: {
    backgroundColor: "#2563eb",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    shadowColor: "#2563eb",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  signupButtonDisabled: { opacity: 0.55, shadowOpacity: 0 },
  signupButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.3,
  },

  // Divider
  divider: { flexDirection: "row", alignItems: "center", marginVertical: 24 },
  dividerLine: { flex: 1, height: 1, backgroundColor: "#e5e7eb" },
  dividerText: {
    marginHorizontal: 12,
    fontSize: 13,
    color: "#9ca3af",
    fontWeight: "500",
  },

  // Login link
  loginContainer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  loginText: { fontSize: 14, color: "#6b7280" },
  loginLink: { fontSize: 14, color: "#2563eb", fontWeight: "700" },
});
