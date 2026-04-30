// components/PermissionButton.tsx
import React from "react";
import {
    ActivityIndicator,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import Colors from "../constants/colors";
import { useCaregiverPermissions } from "../hooks/useCaregiverPermissions";

interface PermissionButtonProps {
  patientId: string;
  caregiverId: string;
  requiredPermission: "manageReminders" | "markAsTaken" | "manageHealth";
  onPress: () => void;
  title: string;
  icon?: React.ReactNode;
  style?: any;
  disabled?: boolean;
}

export const PermissionButton: React.FC<PermissionButtonProps> = ({
  patientId,
  caregiverId,
  requiredPermission,
  onPress,
  title,
  icon,
  style,
  disabled = false,
}) => {
  const { can, loading } = useCaregiverPermissions({ patientId, caregiverId });
  const hasPermission = can[requiredPermission]();

  if (loading) {
    return (
      <View style={[styles.button, styles.disabledButton, style]}>
        <ActivityIndicator size="small" color={Colors.textTertiary} />
      </View>
    );
  }

  const isDisabled = disabled || !hasPermission;

  return (
    <TouchableOpacity
      style={[styles.button, isDisabled && styles.disabledButton, style]}
      onPress={onPress}
      disabled={isDisabled}
    >
      {icon && icon}
      <Text
        style={[styles.buttonText, isDisabled && styles.disabledButtonText]}
      >
        {title}
        {!hasPermission && !disabled && " (Locked)"}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  disabledButton: {
    backgroundColor: Colors.border,
    opacity: 0.6,
  },
  buttonText: {
    color: Colors.surface,
    fontWeight: "600",
    fontSize: 14,
  },
  disabledButtonText: {
    color: Colors.textTertiary,
  },
});
