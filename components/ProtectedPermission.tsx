// components/ProtectedPermission.tsx
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import Colors from "../constants/colors";
import { useCaregiverPermissions } from "../hooks/useCaregiverPermissions";

interface ProtectedPermissionProps {
  patientId: string;
  caregiverId: string;
  requiredPermission: keyof ReturnType<typeof useCaregiverPermissions>["can"];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export const ProtectedPermission: React.FC<ProtectedPermissionProps> = ({
  patientId,
  caregiverId,
  requiredPermission,
  children,
  fallback,
}) => {
  const { can, loading } = useCaregiverPermissions({ patientId, caregiverId });

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="small" color={Colors.primary} />
      </View>
    );
  }

  const hasPermission = can[requiredPermission]();

  if (!hasPermission) {
    return fallback ? (
      <>{fallback}</>
    ) : (
      <View style={styles.noAccessContainer}>
        <Ionicons name="lock-closed" size={24} color={Colors.textTertiary} />
        <Text style={styles.noAccessText}>
          You don't have permission to view this
        </Text>
      </View>
    );
  }

  return <>{children}</>;
};

const styles = StyleSheet.create({
  loadingContainer: {
    padding: 20,
    alignItems: "center",
  },
  noAccessContainer: {
    padding: 40,
    alignItems: "center",
    gap: 12,
  },
  noAccessText: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: "center",
  },
});
