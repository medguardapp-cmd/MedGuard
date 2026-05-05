// app/(auth)/login.tsx
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../../hooks/useAuth";

// --- Firebase error mapper ---
const mapFirebaseError = (raw: string): string => {
  const code = raw?.match(/\(([^)]+)\)/)?.[1] ?? raw ?? "";
  const map: Record<string, string> = {
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/wrong-password": "Incorrect password. Please try again.",
    "auth/user-not-found": "No account found with this email.",
    "auth/invalid-email": "That email address isn't valid.",
    "auth/user-disabled": "This account has been disabled. Contact support.",
    "auth/too-many-requests":
      "Too many failed attempts. Please wait a moment and try again.",
    "auth/network-request-failed":
      "Network error. Check your connection and try again.",
    "auth/email-already-in-use": "An account with this email already exists.",
    "auth/weak-password": "Password is too weak. Use at least 6 characters.",
    "auth/operation-not-allowed":
      "Sign-in is currently unavailable. Contact support.",
    "auth/popup-closed-by-user": "Sign-in was cancelled.",
    "auth/requires-recent-login": "Please sign in again to continue.",
  };
  return map[code] ?? "Something went wrong. Please try again.";
};

// --- Validation helpers ---
const validateEmail = (email: string): string | null => {
  if (!email.trim()) return "Email is required";
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) return "Enter a valid email address";
  return null;
};

const validatePassword = (password: string): string | null => {
  if (!password) return "Password is required";
  if (password.length < 6) return "Password must be at least 6 characters";
  return null;
};

// --- Eye Icons (pure React Native, no dependencies) ---
function EyeIcon() {
  return (
    <View style={eyeStyles.container}>
      {/* Outer eye shape */}
      <View style={eyeStyles.outer} />
      {/* Pupil */}
      <View style={eyeStyles.pupil} />
    </View>
  );
}

function EyeOffIcon() {
  return (
    <View style={eyeStyles.container}>
      {/* Outer eye shape, faded */}
      <View style={[eyeStyles.outer, eyeStyles.outerFaded]} />
      {/* Diagonal slash line */}
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
  // Oval outline mimicking the eye shape
  outer: {
    width: 20,
    height: 12,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#9ca3af",
    position: "absolute",
  },
  outerFaded: {
    borderColor: "#c4c9d4",
  },
  // Filled circle for the pupil
  pupil: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#9ca3af",
    position: "absolute",
  },
  // Rotated bar for the "off" slash
  slash: {
    position: "absolute",
    width: 2,
    height: 22,
    borderRadius: 1,
    backgroundColor: "#9ca3af",
    transform: [{ rotate: "45deg" }],
  },
});

// --- Field component ---
interface FieldProps {
  label: string;
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
}

function Field({
  label,
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
      {hasError && <Text style={fieldStyles.errorText}>{error}</Text>}
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

// --- Unverified Email Banner ---
function UnverifiedBanner({
  email,
  onResend,
}: {
  email: string;
  onResend: () => void;
}) {
  return (
    <View style={unverifiedStyles.container}>
      <Text style={unverifiedStyles.icon}>📧</Text>
      <View style={{ flex: 1 }}>
        <Text style={unverifiedStyles.title}>Email not verified</Text>
        <Text style={unverifiedStyles.text}>
          Please verify your email before signing in.
        </Text>
        <TouchableOpacity
          onPress={onResend}
          style={unverifiedStyles.resendButton}
        >
          <Text style={unverifiedStyles.resendText}>Resend verification →</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const unverifiedStyles = StyleSheet.create({
  container: {
    flexDirection: "row",
    backgroundColor: "#fffbeb",
    borderWidth: 1,
    borderColor: "#fde68a",
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
    gap: 10,
  },
  icon: { fontSize: 18 },
  title: { fontSize: 13, fontWeight: "700", color: "#92400e", marginBottom: 2 },
  text: { fontSize: 13, color: "#92400e", lineHeight: 18 },
  resendButton: { marginTop: 6 },
  resendText: { fontSize: 13, color: "#d97706", fontWeight: "600" },
});

// --- Forgot Password Modal ---
type ForgotStep = "input" | "sending" | "sent" | "error";

function ForgotPasswordModal({
  visible,
  onClose,
  resetPassword,
}: {
  visible: boolean;
  onClose: () => void;
  resetPassword: (
    email: string,
  ) => Promise<{ success: boolean; error?: string }>;
}) {
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<ForgotStep>("input");
  const [errorMsg, setErrorMsg] = useState("");
  const emailError =
    email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
      ? "Enter a valid email address"
      : null;

  const handleClose = () => {
    onClose();
    setTimeout(() => {
      setEmail("");
      setStep("input");
      setErrorMsg("");
    }, 300);
  };

  const handleSend = async () => {
    if (!email.trim() || emailError) return;
    setStep("sending");
    const result = await resetPassword(email.trim());
    if (result.success) {
      setStep("sent");
    } else {
      setErrorMsg(mapFirebaseError(result.error ?? ""));
      setStep("error");
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <TouchableOpacity
        style={modalStyles.overlay}
        activeOpacity={1}
        onPress={handleClose}
      >
        <TouchableOpacity activeOpacity={1} style={modalStyles.sheet}>
          {/* Sent state */}
          {step === "sent" ? (
            <View style={modalStyles.sentContainer}>
              <View style={modalStyles.sentIcon}>
                <Text style={{ fontSize: 32 }}>✉️</Text>
              </View>
              <Text style={modalStyles.sentTitle}>Check your inbox</Text>
              <Text style={modalStyles.sentText}>
                We sent password reset instructions to{"\n"}
                <Text style={{ fontWeight: "700" }}>{email.trim()}</Text>
              </Text>
              <Text style={modalStyles.sentHint}>
                Don&apos;t see it? Check your spam folder.
              </Text>
              <TouchableOpacity
                style={modalStyles.doneButton}
                onPress={handleClose}
              >
                <Text style={modalStyles.doneButtonText}>Done</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={modalStyles.handle} />
              <Text style={modalStyles.title}>Reset Password</Text>
              <Text style={modalStyles.subtitle}>
                Enter your email and we&apos;ll send you instructions to reset
                your password.
              </Text>

              {step === "error" && (
                <View style={modalStyles.errorBox}>
                  <Text style={modalStyles.errorBoxText}>⚠️ {errorMsg}</Text>
                </View>
              )}

              <Text style={modalStyles.label}>Email Address</Text>
              <View
                style={[
                  modalStyles.inputWrapper,
                  emailError ? modalStyles.inputWrapperError : null,
                ]}
              >
                <TextInput
                  style={modalStyles.input}
                  placeholder="you@example.com"
                  placeholderTextColor="#9ca3af"
                  value={email}
                  onChangeText={(t) => {
                    setEmail(t);
                    if (step === "error") setStep("input");
                  }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus
                />
              </View>
              {emailError && (
                <Text style={modalStyles.fieldError}>{emailError}</Text>
              )}

              <TouchableOpacity
                style={[
                  modalStyles.sendButton,
                  (!email.trim() || !!emailError || step === "sending") &&
                    modalStyles.sendButtonDisabled,
                ]}
                onPress={handleSend}
                disabled={!email.trim() || !!emailError || step === "sending"}
              >
                {step === "sending" ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={modalStyles.sendButtonText}>
                    Send Reset Link
                  </Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={modalStyles.cancelButton}
                onPress={handleClose}
              >
                <Text style={modalStyles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: Platform.OS === "ios" ? 40 : 28,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#e5e7eb",
    alignSelf: "center",
    marginBottom: 20,
  },
  title: { fontSize: 20, fontWeight: "700", color: "#111827", marginBottom: 8 },
  subtitle: {
    fontSize: 14,
    color: "#6b7280",
    lineHeight: 20,
    marginBottom: 24,
  },
  label: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6 },
  inputWrapper: {
    borderWidth: 1.5,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    backgroundColor: "#f9fafb",
    marginBottom: 4,
  },
  inputWrapperError: { borderColor: "#ef4444", backgroundColor: "#fff5f5" },
  input: { padding: 14, fontSize: 15, color: "#111827" },
  fieldError: {
    fontSize: 12,
    color: "#ef4444",
    fontWeight: "500",
    marginBottom: 4,
  },
  errorBox: {
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca",
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  errorBoxText: { fontSize: 13, color: "#b91c1c", fontWeight: "500" },
  sendButton: {
    backgroundColor: "#2563eb",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 20,
    shadowColor: "#2563eb",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  sendButtonDisabled: { opacity: 0.5, shadowOpacity: 0 },
  sendButtonText: { color: "white", fontSize: 16, fontWeight: "700" },
  cancelButton: { padding: 14, alignItems: "center", marginTop: 8 },
  cancelText: { fontSize: 15, color: "#6b7280", fontWeight: "500" },
  // Sent state
  sentContainer: { alignItems: "center", paddingVertical: 16 },
  sentIcon: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: "#eff6ff",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  sentTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 10,
  },
  sentText: {
    fontSize: 15,
    color: "#6b7280",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 8,
  },
  sentHint: { fontSize: 13, color: "#9ca3af", marginBottom: 28 },
  doneButton: {
    backgroundColor: "#2563eb",
    paddingVertical: 14,
    paddingHorizontal: 48,
    borderRadius: 12,
    shadowColor: "#2563eb",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  doneButtonText: { color: "white", fontSize: 16, fontWeight: "700" },
});

// --- Main screen ---
export default function LoginScreen() {
  const router = useRouter();
  const { signIn, resetPassword } = useAuth();

  const [formData, setFormData] = useState({ email: "", password: "" });
  const [touched, setTouched] = useState({ email: false, password: false });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [showForgot, setShowForgot] = useState(false);

  const errors = {
    email: validateEmail(formData.email),
    password: validatePassword(formData.password),
  };

  const isFormValid = !errors.email && !errors.password;

  const touch = (field: "email" | "password") =>
    setTouched((prev) => ({ ...prev, [field]: true }));

  const touchAll = () => setTouched({ email: true, password: true });

  const clearErrors = () => {
    setLoginError(null);
    setUnverified(false);
  };

  const handleLogin = async () => {
    touchAll();
    clearErrors();
    if (!isFormValid) return;

    setLoading(true);
    const result = await signIn(formData.email.trim(), formData.password);
    setLoading(false);

    if (result.success) {
      if (!result.user?.emailVerified) {
        setUnverified(true);
      } else {
        router.replace("/(tabs)");
      }
    } else {
      setLoginError(mapFirebaseError(result.error ?? ""));
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 20}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => router.back()}
            >
              <Text style={styles.backButtonText}>←</Text>
            </TouchableOpacity>
            <Text style={styles.title}>Welcome Back</Text>
            <Text style={styles.subtitle}>
              Sign in to your MedGuard account
            </Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            {/* Inline error banners */}
            {loginError && (
              <ErrorBanner
                message={loginError}
                onDismiss={() => setLoginError(null)}
              />
            )}
            {unverified && (
              <UnverifiedBanner
                email={formData.email.trim()}
                onResend={() => {
                  setUnverified(false);
                  router.push({
                    pathname: "/(auth)/verify-email",
                    params: { email: formData.email.trim() },
                  });
                }}
              />
            )}

            <Field
              label="Email Address"
              value={formData.email}
              onChange={(text) => {
                setFormData({ ...formData, email: text });
                clearErrors();
              }}
              onBlur={() => touch("email")}
              error={errors.email}
              touched={touched.email}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <Field
              label="Password"
              value={formData.password}
              onChange={(text) => {
                setFormData({ ...formData, password: text });
                clearErrors();
              }}
              onBlur={() => touch("password")}
              error={errors.password}
              touched={touched.password}
              placeholder="Enter your password"
              secure
              showToggle
              showPassword={showPassword}
              onTogglePassword={() => setShowPassword((v) => !v)}
            />

            <TouchableOpacity
              style={styles.forgotPassword}
              onPress={() => setShowForgot(true)}
            >
              <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.loginButton,
                (!isFormValid || loading) && styles.loginButtonDisabled,
              ]}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={styles.loginButtonText}>Sign In</Text>
              )}
            </TouchableOpacity>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            <View style={styles.signupContainer}>
              <Text style={styles.signupText}>Don&apos;t have an account?</Text>
              <TouchableOpacity
                onPress={() => router.push("/(auth)/signup")}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
              >
                <Text style={styles.signupLink}> Sign Up</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <ForgotPasswordModal
        visible={showForgot}
        onClose={() => setShowForgot(false)}
        resetPassword={resetPassword}
      />
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
  forgotPassword: { alignSelf: "flex-end", marginBottom: 28, marginTop: -4 },
  forgotPasswordText: { color: "#3b82f6", fontSize: 14, fontWeight: "600" },

  // Button
  loginButton: {
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
  loginButtonDisabled: { opacity: 0.55, shadowOpacity: 0 },
  loginButtonText: {
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

  // Signup
  signupContainer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  signupText: { fontSize: 14, color: "#6b7280" },
  signupLink: { fontSize: 14, color: "#2563eb", fontWeight: "700" },
});
