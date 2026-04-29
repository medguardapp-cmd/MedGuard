// app/(caregiver-only)/_layout.tsx
import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";
import { StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "../../constants/colors";

export default function CaregiverOnlyLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textTertiary,
        tabBarStyle: {
          ...styles.tabBar,
          bottom: insets.bottom + 5,
        },
        tabBarLabelStyle: styles.tabBarLabel,
      }}
    >
      <Tabs.Screen
        name="connect"
        options={{
          title: "Connect",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-add-outline" size={size} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    position: "absolute",
    left: 0,
    right: 0,
    marginHorizontal: 10,
    height: 60,
    borderRadius: 30,
    backgroundColor: "rgba(255,255,255,0.98)",
    borderTopWidth: 0,
    elevation: 8,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 10,
  },
  tabBarLabel: {
    fontSize: 12,
    fontWeight: "500",
  },
});
