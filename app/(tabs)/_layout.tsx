// app/(tabs)/_layout.tsx
import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";
import { StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HapticTab } from "@/components/haptic-tab";
import Colors from "@/constants/colors"; // ← Change this path to your colors file
import { SelectedPatientProvider } from "@/contexts/SelectedPatientContext";

export default function TabLayout() {
  const insets = useSafeAreaInsets();

  return (
    <SelectedPatientProvider>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarShowLabel: false,
          tabBarActiveTintColor: Colors.primary,
          tabBarInactiveTintColor: "#999",
          tabBarButton: HapticTab,
          tabBarStyle: [styles.tabBar, { bottom: insets.bottom + 5 }],
          tabBarItemStyle: styles.item,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            tabBarIcon: ({ color }) => (
              <Ionicons name="home-outline" size={22} color={color} />
            ),
          }}
        />

        <Tabs.Screen
          name="MedicationsScreen"
          options={{
            tabBarIcon: ({ color }) => (
              <Ionicons name="medkit-outline" size={22} color={color} />
            ),
          }}
        />

        <Tabs.Screen
          name="AssistantScreen"
          options={{
            tabBarIcon: ({ color }) => (
              <Ionicons name="chatbubble-outline" size={22} color={color} />
            ),
          }}
        />

        <Tabs.Screen
          name="MoreScreen"
          options={{
            tabBarIcon: ({ color }) => (
              <Ionicons name="menu-outline" size={22} color={color} />
            ),
          }}
        />

        <Tabs.Screen
          name="medication-logs"
          options={{
            href: null,
          }}
        />
        <Tabs.Screen
          name="notifications"
          options={{
            href: null,
          }}
        />
      </Tabs>
    </SelectedPatientProvider>
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
  item: {
    paddingVertical: 10,
  },
});
