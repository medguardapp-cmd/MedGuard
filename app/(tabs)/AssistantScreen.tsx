// app/(tabs)/assistant.tsx
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import Colors from "../../constants/colors";

// Types
interface Message {
  id: string;
  text: string;
  sender: "user" | "assistant";
  timestamp: Date;
  type?: "text" | "medication" | "reminder" | "health" | "suggestion";
  data?: any;
}

interface Medication {
  id: string;
  name: string;
  dosage: string;
  time?: string;
  taken?: boolean;
}

interface HealthMetric {
  type: string;
  value: string;
  unit: string;
  trend?: "up" | "down" | "stable";
}

interface QuickAction {
  id: string;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  action: () => void;
}

export default function AssistantScreen() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      text: "Hello! I'm your MEADGUARD AI Assistant. How can I help you with your medications today?",
      sender: "assistant",
      timestamp: new Date(),
      type: "text",
    },
  ]);
  const [inputText, setInputText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [showMedications, setShowMedications] = useState(false);
  const [showReminders, setShowReminders] = useState(false);
  const [showHealthMetrics, setShowHealthMetrics] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());

  const scrollViewRef = useRef<ScrollView>(null);

  // Mock data
  const [medications, setMedications] = useState<Medication[]>([
    {
      id: "1",
      name: "Atorvastatin",
      dosage: "10mg",
      time: "08:00",
      taken: true,
    },
    { id: "2", name: "Metformin", dosage: "500mg", time: "08:00", taken: true },
    {
      id: "3",
      name: "Metformin",
      dosage: "500mg",
      time: "20:00",
      taken: false,
    },
    {
      id: "4",
      name: "Lisinopril",
      dosage: "20mg",
      time: "18:00",
      taken: false,
    },
  ]);

  const [healthMetrics, setHealthMetrics] = useState<HealthMetric[]>([
    { type: "Blood Pressure", value: "120/80", unit: "mmHg", trend: "stable" },
    { type: "Heart Rate", value: "72", unit: "bpm", trend: "stable" },
    { type: "Blood Sugar", value: "95", unit: "mg/dL", trend: "down" },
    { type: "Weight", value: "165", unit: "lbs", trend: "stable" },
  ]);

  const quickActions: QuickAction[] = [
    {
      id: "qa1",
      title: "Today's Meds",
      icon: "today",
      action: () => handleQuickAction("Show me today's medications"),
    },
    {
      id: "qa2",
      title: "Missed Doses",
      icon: "alert-circle",
      action: () => handleQuickAction("Which medications did I miss?"),
    },
    {
      id: "qa3",
      title: "Drug Interaction",
      icon: "medkit",
      action: () => handleQuickAction("Check drug interactions"),
    },
    {
      id: "qa4",
      title: "Refill Reminder",
      icon: "refresh",
      action: () => handleQuickAction("What medications need refills?"),
    },
    {
      id: "qa5",
      title: "Health Tips",
      icon: "bulb",
      action: () => handleQuickAction("Give me health tips"),
    },
    {
      id: "qa6",
      title: "Emergency",
      icon: "warning",
      action: () => handleQuickAction("Emergency assistance"),
      color: Colors.error,
    },
  ];

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);
  };

  const handleQuickAction = (query: string) => {
    sendMessage(query);
  };

  const sendMessage = async (text: string) => {
    if (!text.trim()) return;

    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      text: text,
      sender: "user",
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInputText("");
    setIsTyping(true);

    // Simulate AI thinking
    setTimeout(() => {
      const response = generateAIResponse(text);
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: response.text,
        sender: "assistant",
        timestamp: new Date(),
        type: response.type,
        data: response.data,
      };
      setMessages((prev) => [...prev, assistantMessage]);
      setIsTyping(false);
    }, 1500);
  };

  const generateAIResponse = (
    query: string,
  ): { text: string; type: Message["type"]; data?: any } => {
    const lowerQuery = query.toLowerCase();

    // Today's medications
    if (lowerQuery.includes("today") && lowerQuery.includes("med")) {
      const todayMeds = medications.filter((m) => {
        const medTime = m.time || "00:00";
        return medTime >= "00:00";
      });
      return {
        type: "medication",
        text: `Here are your medications for today. You've taken ${todayMeds.filter((m) => m.taken).length} out of ${todayMeds.length} doses.`,
        data: todayMeds,
      };
    }

    // Missed doses
    if (lowerQuery.includes("miss") || lowerQuery.includes("forgot")) {
      const missedMeds = medications.filter((m) => !m.taken);
      if (missedMeds.length === 0) {
        return {
          type: "text",
          text: "Great job! You haven't missed any medications today. Keep up the good work! 💪",
        };
      }
      return {
        type: "medication",
        text: `You have ${missedMeds.length} missed doses today. Would you like me to remind you to take them now?`,
        data: missedMeds,
      };
    }

    // Refill reminders
    if (
      lowerQuery.includes("refill") ||
      lowerQuery.includes("refill reminder")
    ) {
      const lowMeds = medications.filter(
        (m) => m.name === "Atorvastatin" || m.name === "Metformin",
      );
      if (lowMeds.length === 0) {
        return {
          type: "text",
          text: "All your medications have sufficient supply. No refills needed at this time.",
        };
      }
      return {
        type: "medication",
        text: "The following medications need refills soon. Would you like me to help you order them?",
        data: lowMeds.map((m) => ({ ...m, refillNeeded: true })),
      };
    }

    // Drug interactions
    if (
      lowerQuery.includes("interaction") ||
      lowerQuery.includes("drug interaction")
    ) {
      return {
        type: "health",
        text: "I've checked your current medications for potential interactions. Here's what I found:",
        data: {
          interactions: [
            {
              meds: ["Atorvastatin", "Grapefruit"],
              severity: "moderate",
              advice: "Avoid grapefruit juice",
            },
            {
              meds: ["Metformin", "Alcohol"],
              severity: "mild",
              advice: "Limit alcohol intake",
            },
          ],
          safe: true,
        },
      };
    }

    // Health tips
    if (
      lowerQuery.includes("tip") ||
      lowerQuery.includes("advice") ||
      lowerQuery.includes("health tip")
    ) {
      const tips = [
        "💊 Take medications at the same time each day to build a routine",
        "💧 Stay hydrated - it helps medication absorption",
        "📱 Use the medication tracker to never miss a dose",
        "🏃‍♂️ Regular exercise can enhance medication effectiveness",
        "🍎 A healthy diet supports your overall treatment plan",
        "⏰ Set multiple reminders for important medications",
        "📝 Keep a medication journal to track side effects",
        "👨‍⚕️ Always consult your doctor before stopping any medication",
      ];
      return {
        type: "suggestion",
        text: "Here are some helpful health tips for you:",
        data: tips,
      };
    }

    // Emergency/SOS
    if (
      lowerQuery.includes("emergency") ||
      lowerQuery.includes("sos") ||
      lowerQuery.includes("help")
    ) {
      return {
        type: "suggestion",
        text: "🚨 If this is a medical emergency, please call emergency services immediately (911 in the US).\n\nHere are emergency contacts and next steps:",
        data: {
          emergency: "911",
          poisonControl: "1-800-222-1222",
          steps: [
            "Call emergency services if you're experiencing severe symptoms",
            "Contact your doctor or local pharmacy",
            "Reach out to a family member or friend",
            "Use the SOS feature in the app for immediate alerts",
          ],
        },
      };
    }

    // Medication schedule
    if (lowerQuery.includes("schedule") || lowerQuery.includes("when")) {
      return {
        type: "medication",
        text: "Here's your medication schedule for today:",
        data: medications.sort((a, b) =>
          (a.time || "00:00").localeCompare(b.time || "00:00"),
        ),
      };
    }

    // Health metrics
    if (
      lowerQuery.includes("health") ||
      lowerQuery.includes("metrics") ||
      lowerQuery.includes("vitals")
    ) {
      return {
        type: "health",
        text: "Here are your latest health metrics:",
        data: healthMetrics,
      };
    }

    // Default response
    return {
      type: "text",
      text: "I'm here to help you manage your medications. You can ask me about:\n\n• Today's medications\n• Missed doses\n• Refill reminders\n• Drug interactions\n• Health tips\n• Your medication schedule\n• Emergency assistance\n\nWhat would you like to know?",
    };
  };

  const handleMarkAsTaken = (medicationId: string) => {
    setMedications((prev) =>
      prev.map((med) =>
        med.id === medicationId ? { ...med, taken: true } : med,
      ),
    );

    // Add confirmation message
    const confirmationMessage: Message = {
      id: Date.now().toString(),
      text: "✅ Great! I've marked that medication as taken. Keep up the good work!",
      sender: "assistant",
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, confirmationMessage]);
  };

  const handleSetReminder = (medicationName: string) => {
    Alert.alert(
      "Set Reminder",
      `Would you like to set a reminder for ${medicationName}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Set Reminder",
          onPress: () => {
            const reminderMessage: Message = {
              id: Date.now().toString(),
              text: `✅ I've set a reminder for ${medicationName}. You'll be notified at the scheduled time.`,
              sender: "assistant",
              timestamp: new Date(),
            };
            setMessages((prev) => [...prev, reminderMessage]);
          },
        },
      ],
    );
  };

  const formatTime = (time?: string) => {
    if (!time) return "";
    const [hours, minutes] = time.split(":");
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? "PM" : "AM";
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  };

  const renderMessage = (message: Message) => {
    const isUser = message.sender === "user";

    return (
      <View
        key={message.id}
        style={[
          styles.messageContainer,
          isUser
            ? styles.userMessageContainer
            : styles.assistantMessageContainer,
        ]}
      >
        {!isUser && (
          <View style={styles.assistantAvatar}>
            <Ionicons name="medical" size={20} color={Colors.surface} />
          </View>
        )}

        <View
          style={[
            styles.messageBubble,
            isUser ? styles.userBubble : styles.assistantBubble,
          ]}
        >
          <Text style={[styles.messageText, isUser && styles.userMessageText]}>
            {message.text}
          </Text>

          {/* Render medication data */}
          {message.type === "medication" && message.data && (
            <View style={styles.messageData}>
              {message.data.map((med: any, index: number) => (
                <View key={index} style={styles.medicationItem}>
                  <View style={styles.medicationInfo}>
                    <Text style={styles.medicationName}>{med.name}</Text>
                    <Text style={styles.medicationDosage}>{med.dosage}</Text>
                    {med.time && (
                      <Text style={styles.medicationTime}>
                        {formatTime(med.time)}
                      </Text>
                    )}
                  </View>
                  {med.taken !== undefined && (
                    <TouchableOpacity
                      style={[
                        styles.takenButton,
                        med.taken && styles.takenButtonActive,
                      ]}
                      onPress={() => handleMarkAsTaken(med.id)}
                      disabled={med.taken}
                    >
                      <Text style={styles.takenButtonText}>
                        {med.taken ? "✓ Taken" : "Mark Taken"}
                      </Text>
                    </TouchableOpacity>
                  )}
                  {med.refillNeeded && (
                    <TouchableOpacity
                      style={styles.refillButton}
                      onPress={() => handleSetReminder(med.name)}
                    >
                      <Ionicons
                        name="refresh"
                        size={16}
                        color={Colors.primary}
                      />
                      <Text style={styles.refillButtonText}>Order Refill</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </View>
          )}

          {/* Render health data */}
          {message.type === "health" && message.data && (
            <View style={styles.messageData}>
              {message.data.interactions
                ? // Drug interactions
                  message.data.interactions.map(
                    (interaction: any, index: number) => (
                      <View key={index} style={styles.interactionItem}>
                        <View style={styles.interactionHeader}>
                          <Text style={styles.interactionMeds}>
                            {interaction.meds.join(" + ")}
                          </Text>
                          <View
                            style={[
                              styles.severityBadge,
                              {
                                backgroundColor:
                                  interaction.severity === "severe"
                                    ? Colors.error
                                    : interaction.severity === "moderate"
                                      ? Colors.warning
                                      : Colors.success,
                              },
                            ]}
                          >
                            <Text style={styles.severityText}>
                              {interaction.severity}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.interactionAdvice}>
                          {interaction.advice}
                        </Text>
                      </View>
                    ),
                  )
                : // Health metrics
                  message.data.map((metric: HealthMetric, index: number) => (
                    <View key={index} style={styles.metricItem}>
                      <Text style={styles.metricType}>{metric.type}</Text>
                      <View style={styles.metricValueContainer}>
                        <Text style={styles.metricValue}>{metric.value}</Text>
                        <Text style={styles.metricUnit}>{metric.unit}</Text>
                        {metric.trend && (
                          <Ionicons
                            name={
                              metric.trend === "up"
                                ? "arrow-up"
                                : metric.trend === "down"
                                  ? "arrow-down"
                                  : "remove"
                            }
                            size={16}
                            color={
                              metric.trend === "up"
                                ? Colors.error
                                : metric.trend === "down"
                                  ? Colors.success
                                  : Colors.textSecondary
                            }
                          />
                        )}
                      </View>
                    </View>
                  ))}
            </View>
          )}

          {/* Render suggestions/tips */}
          {message.type === "suggestion" && message.data && (
            <View style={styles.messageData}>
              {Array.isArray(message.data) ? (
                // Tips list
                message.data.map((tip: string, index: number) => (
                  <View key={index} style={styles.tipItem}>
                    <Text style={styles.tipText}>{tip}</Text>
                  </View>
                ))
              ) : (
                // Emergency data
                <View style={styles.emergencyContainer}>
                  <View style={styles.emergencyContact}>
                    <Text style={styles.emergencyLabel}>Emergency:</Text>
                    <Text style={styles.emergencyNumber}>
                      {message.data.emergency}
                    </Text>
                  </View>
                  <View style={styles.emergencyContact}>
                    <Text style={styles.emergencyLabel}>Poison Control:</Text>
                    <Text style={styles.emergencyNumber}>
                      {message.data.poisonControl}
                    </Text>
                  </View>
                  <Text style={styles.emergencyStepsTitle}>Next Steps:</Text>
                  {message.data.steps.map((step: string, index: number) => (
                    <View key={index} style={styles.emergencyStep}>
                      <Text style={styles.emergencyStepNumber}>
                        {index + 1}.
                      </Text>
                      <Text style={styles.emergencyStepText}>{step}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          <Text style={styles.timestamp}>
            {message.timestamp.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="medical" size={28} color={Colors.primary} />
          <Text style={styles.headerTitle}>AI Assistant</Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.headerButton}>
            <Ionicons
              name="help-circle-outline"
              size={24}
              color={Colors.primary}
            />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerButton}>
            <Ionicons
              name="settings-outline"
              size={24}
              color={Colors.primary}
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* Quick Actions */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.quickActionsContainer}
        contentContainerStyle={styles.quickActionsContent}
      >
        {quickActions.map((action) => (
          <TouchableOpacity
            key={action.id}
            style={[
              styles.quickAction,
              action.color && { borderColor: action.color },
            ]}
            onPress={action.action}
          >
            <Ionicons
              name={action.icon}
              size={20}
              color={action.color || Colors.primary}
            />
            <Text
              style={[
                styles.quickActionText,
                action.color && { color: action.color },
              ]}
            >
              {action.title}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Messages */}
      <KeyboardAvoidingView
        style={[styles.messagesContainer, { marginBottom: 70 }]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        <ScrollView
          ref={scrollViewRef}
          style={styles.messagesList}
          contentContainerStyle={styles.messagesContent}
          showsVerticalScrollIndicator={false}
        >
          {messages.map(renderMessage)}
          {isTyping && (
            <View style={styles.typingIndicator}>
              <View style={styles.assistantAvatar}>
                <Ionicons name="medical" size={20} color={Colors.surface} />
              </View>
              <View style={styles.typingBubble}>
                <ActivityIndicator size="small" color={Colors.primary} />
                <Text style={styles.typingText}>AI is thinking...</Text>
              </View>
            </View>
          )}
        </ScrollView>

        {/* Input */}
        <View style={styles.inputContainer}>
          <TouchableOpacity style={styles.attachButton}>
            <Ionicons name="attach" size={24} color={Colors.textSecondary} />
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            placeholder="Ask me anything about your medications..."
            placeholderTextColor={Colors.textTertiary}
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={500}
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              !inputText.trim() && styles.sendButtonDisabled,
            ]}
            onPress={() => sendMessage(inputText)}
            disabled={!inputText.trim()}
          >
            <Ionicons
              name="send"
              size={20}
              color={inputText.trim() ? Colors.surface : Colors.textTertiary}
            />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: Colors.text,
  },
  headerRight: {
    flexDirection: "row",
    gap: 16,
  },
  headerButton: {
    padding: 4,
  },
  quickActionsContainer: {
    maxHeight: 80,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  quickActionsContent: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  quickAction: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: Colors.background,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.primary + "30",
    gap: 6,
  },
  quickActionText: {
    fontSize: 14,
    color: Colors.primary,
    fontWeight: "500",
  },
  messagesContainer: {
    flex: 1,
  },
  messagesList: {
    flex: 1,
  },
  messagesContent: {
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  messageContainer: {
    flexDirection: "row",
    marginBottom: 16,
    maxWidth: "80%",
  },
  userMessageContainer: {
    alignSelf: "flex-end",
  },
  assistantMessageContainer: {
    alignSelf: "flex-start",
  },
  assistantAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
    alignSelf: "flex-end",
  },
  messageBubble: {
    borderRadius: 20,
    padding: 12,
    maxWidth: "100%",
  },
  userBubble: {
    backgroundColor: Colors.primary,
  },
  assistantBubble: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  messageText: {
    fontSize: 16,
    lineHeight: 22,
    color: Colors.text,
  },
  userMessageText: {
    color: Colors.surface,
  },
  timestamp: {
    fontSize: 10,
    color: Colors.textTertiary,
    marginTop: 4,
    alignSelf: "flex-end",
  },
  messageData: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border + "30",
    paddingTop: 12,
  },
  medicationItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border + "20",
  },
  medicationInfo: {
    flex: 1,
  },
  medicationName: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.text,
  },
  medicationDosage: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  medicationTime: {
    fontSize: 11,
    color: Colors.primary,
    marginTop: 2,
  },
  takenButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: Colors.primary + "15",
    borderRadius: 16,
  },
  takenButtonActive: {
    backgroundColor: Colors.success + "20",
  },
  takenButtonText: {
    fontSize: 12,
    color: Colors.primary,
    fontWeight: "500",
  },
  refillButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: Colors.primary + "10",
    borderRadius: 16,
    gap: 4,
  },
  refillButtonText: {
    fontSize: 12,
    color: Colors.primary,
    fontWeight: "500",
  },
  interactionItem: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border + "20",
  },
  interactionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  interactionMeds: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.text,
  },
  severityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  severityText: {
    fontSize: 10,
    color: Colors.surface,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  interactionAdvice: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  metricItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border + "20",
  },
  metricType: {
    fontSize: 14,
    color: Colors.text,
  },
  metricValueContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metricValue: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.text,
  },
  metricUnit: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginRight: 4,
  },
  tipItem: {
    paddingVertical: 6,
  },
  tipText: {
    fontSize: 14,
    color: Colors.text,
    lineHeight: 20,
  },
  emergencyContainer: {
    backgroundColor: Colors.error + "10",
    padding: 12,
    borderRadius: 12,
  },
  emergencyContact: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  emergencyLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.text,
  },
  emergencyNumber: {
    fontSize: 16,
    fontWeight: "bold",
    color: Colors.error,
  },
  emergencyStepsTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.text,
    marginTop: 8,
    marginBottom: 4,
  },
  emergencyStep: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 4,
  },
  emergencyStepNumber: {
    fontSize: 14,
    color: Colors.error,
    fontWeight: "600",
    width: 20,
  },
  emergencyStepText: {
    flex: 1,
    fontSize: 14,
    color: Colors.text,
  },
  typingIndicator: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    alignSelf: "flex-start",
  },
  typingBubble: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  typingText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  attachButton: {
    padding: 8,
  },
  input: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginHorizontal: 8,
    maxHeight: 100,
    fontSize: 16,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  sendButtonDisabled: {
    backgroundColor: Colors.border,
  },
});
