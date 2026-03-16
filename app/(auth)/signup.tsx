// app/(auth)/signup.tsx
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { useAuth } from "../../hooks/useAuth";

export default function SignupScreen() {
  const router = useRouter();
  const { signUp } = useAuth();

  const [formData, setFormData] = useState({
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [loading, setLoading] = useState(false);

  // In your signup screen, update the handleSignup function:
  const handleSignup = async () => {
    console.log("🚀 [SIGNUP] Starting signup process...");
    console.log("📝 Form data:", {
      email: formData.email,
      passwordLength: formData.password.length,
      confirmPasswordLength: formData.confirmPassword.length,
    });

    // Validation
    if (!formData.email || !formData.password || !formData.confirmPassword) {
      console.error("❌ [SIGNUP] Validation failed: Missing fields");
      Alert.alert("Error", "Please fill in all fields");
      return;
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      console.error("❌ [SIGNUP] Validation failed: Invalid email format");
      Alert.alert("Error", "Please enter a valid email address");
      return;
    }

    // Password validation
    if (formData.password.length < 6) {
      console.error("❌ [SIGNUP] Validation failed: Password too short");
      Alert.alert("Error", "Password must be at least 6 characters");
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      console.error("❌ [SIGNUP] Validation failed: Passwords do not match");
      Alert.alert("Error", "Passwords do not match");
      return;
    }

    console.log("✅ [SIGNUP] All validations passed");
    setLoading(true);

    const result = await signUp(formData.email, formData.password);

    setLoading(false);

    if (result.success) {
      console.log("🎉 [SIGNUP] Success! User created:", {
        userId: result.user?.uid,
        email: result.user?.email,
      });

      // Navigate to verify email screen
      router.push({
        pathname: "/(auth)/verify-email",
        params: { email: formData.email },
      });
    } else {
      console.error("💥 [SIGNUP] Failed:", {
        error: result.error,
        errorCode: result.errorCode,
      });

      // Handle specific Firebase errors
      let errorMessage = "Signup failed. Please try again.";

      if (result.error?.includes("auth/email-already-in-use")) {
        errorMessage =
          "This email is already registered. Please login instead.";
      } else if (result.error?.includes("auth/invalid-email")) {
        errorMessage = "Invalid email address.";
      } else if (result.error?.includes("auth/weak-password")) {
        errorMessage =
          "Password is too weak. Please choose a stronger password.";
      }

      Alert.alert("Signup Failed", errorMessage);
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
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => router.back()}
            >
              <Text style={styles.backButtonText}>←</Text>
            </TouchableOpacity>
            <Text style={styles.title}>Create Account</Text>
            <Text style={styles.subtitle}>
              Secure your health with MedGuard
            </Text>
          </View>

          <View style={styles.form}>
            {/* Email Input */}
            <View style={styles.inputContainer}>
              <Text style={styles.label}>Email Address</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter your email"
                value={formData.email}
                onChangeText={(text) =>
                  setFormData({ ...formData, email: text })
                }
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!loading}
              />
            </View>

            {/* Password Input */}
            <View style={styles.inputContainer}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                style={styles.input}
                placeholder="Create a password"
                value={formData.password}
                onChangeText={(text) =>
                  setFormData({ ...formData, password: text })
                }
                secureTextEntry
                editable={!loading}
              />
              <Text style={styles.helperText}>Minimum 6 characters</Text>
            </View>

            {/* Confirm Password Input */}
            <View style={styles.inputContainer}>
              <Text style={styles.label}>Confirm Password</Text>
              <TextInput
                style={styles.input}
                placeholder="Re-enter your password"
                value={formData.confirmPassword}
                onChangeText={(text) =>
                  setFormData({ ...formData, confirmPassword: text })
                }
                secureTextEntry
                editable={!loading}
                onSubmitEditing={handleSignup}
              />
            </View>

            {/* Sign Up Button */}
            <TouchableOpacity
              style={[
                styles.signupButton,
                loading && styles.signupButtonDisabled,
              ]}
              onPress={handleSignup}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={styles.signupButtonText}>Create Account</Text>
              )}
            </TouchableOpacity>

            {/* Divider */}
            <View style={styles.dividerContainer}>
              <View style={styles.divider} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.divider} />
            </View>

            {/* Login Redirect */}
            <View style={styles.loginContainer}>
              <Text style={styles.loginText}>Already have an account? </Text>
              <TouchableOpacity
                onPress={() => router.push("/(auth)/login")}
                disabled={loading}
              >
                <Text style={styles.loginLink}>Sign In</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
  header: {
    marginBottom: 40,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#f8fafc",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 24,
  },
  backButtonText: {
    fontSize: 20,
    color: "#475569",
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#0f172a",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#64748b",
    lineHeight: 24,
  },
  form: {
    flex: 1,
  },
  inputContainer: {
    marginBottom: 24,
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    color: "#334155",
    marginBottom: 8,
  },
  input: {
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    backgroundColor: "#f8fafc",
    color: "#0f172a",
  },
  helperText: {
    fontSize: 14,
    color: "#94a3b8",
    marginTop: 6,
    marginLeft: 4,
  },
  signupButton: {
    backgroundColor: "#3b82f6",
    padding: 18,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 8,
    shadowColor: "#3b82f6",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  signupButtonDisabled: {
    opacity: 0.7,
  },
  signupButtonText: {
    color: "white",
    fontSize: 18,
    fontWeight: "600",
  },
  dividerContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 32,
  },
  divider: {
    flex: 1,
    height: 1,
    backgroundColor: "#e2e8f0",
  },
  dividerText: {
    marginHorizontal: 16,
    color: "#94a3b8",
    fontSize: 14,
  },
  loginContainer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  loginText: {
    fontSize: 16,
    color: "#64748b",
  },
  loginLink: {
    fontSize: 16,
    color: "#3b82f6",
    fontWeight: "600",
  },
});
