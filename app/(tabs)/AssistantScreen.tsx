// app/(tabs)/assistant.tsx

import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
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
import { auth } from "../../lib/firebase";
import {
  ChatMessage,
  markMedicationTaken,
  preloadUserContext,
  sendChatMessage,
} from "../../lib/openaiService";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  text: string;
  sender: "user" | "assistant";
  timestamp: Date;
  type?: "text" | "medication" | "reminder" | "health" | "suggestion";
  data?: any;
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
  color?: string;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

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
  const [isProfileReady, setIsProfileReady] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [uid, setUid] = useState<string>("");

  const scrollViewRef = useRef<ScrollView>(null);

  // ── Auth listener — NOT async, fire-and-forget preload ───────────────────────
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) {
        setUid(user.uid);
        preloadUserContext(user.uid)
          .then(() => setIsProfileReady(true))
          .catch(() => setIsProfileReady(true));
      }
    });
    return unsubscribe;
  }, []);

  // ── Auto-scroll ───────────────────────────────────────────────────────────────
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    setTimeout(
      () => scrollViewRef.current?.scrollToEnd({ animated: true }),
      100,
    );
  };

  // ── Quick actions ─────────────────────────────────────────────────────────────
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
      action: () =>
        handleQuickAction(
          "Check drug interactions for all my current medications",
        ),
    },
    {
      id: "qa5",
      title: "Health Tips",
      icon: "bulb",
      action: () =>
        handleQuickAction(
          "Give me health tips based on my conditions and medications",
        ),
    },
    {
      id: "qa6",
      title: "Emergency",
      icon: "warning",
      action: () => handleQuickAction("Emergency assistance"),
      color: Colors.error,
    },
  ];

  const handleQuickAction = (query: string) => sendMessage(query);

  // ── Send message ──────────────────────────────────────────────────────────────
  const sendMessage = async (text: string) => {
    if (!text.trim()) return;

    if (!uid) {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          text: "Please wait, your profile is still loading...",
          sender: "assistant",
          timestamp: new Date(),
          type: "text",
        },
      ]);
      return;
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      text,
      sender: "user",
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInputText("");
    setIsTyping(true);

    const updatedHistory: ChatMessage[] = [
      ...chatHistory,
      { role: "user", content: text },
    ];

    try {
      const response = await sendChatMessage(uid, chatHistory, text);

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: response.text,
        sender: "assistant",
        timestamp: new Date(),
        type: response.type,
        data: response.data,
      };

      setMessages((prev) => [...prev, assistantMessage]);

      // ── Sanitize history content — must always be a non-null string ──────────
      // Fixes: "Invalid type for messages[N].content[0]: expected object got string"
      const assistantContent =
        typeof response.text === "string" && response.text.trim()
          ? response.text
          : response.data
            ? JSON.stringify(response.data)
            : "OK";

      setChatHistory([
        ...updatedHistory,
        { role: "assistant", content: assistantContent },
      ]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          text: `Something went wrong: ${err.message}`,
          sender: "assistant",
          timestamp: new Date(),
          type: "text",
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  // ── Mark medication taken ─────────────────────────────────────────────────────
  const handleMarkAsTaken = async (medicationId: string) => {
    if (uid) await markMedicationTaken(uid, medicationId);
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        text: "✅ Great! I've marked that medication as taken. Keep up the good work!",
        sender: "assistant",
        timestamp: new Date(),
      },
    ]);
  };

  // ── Set reminder ──────────────────────────────────────────────────────────────
  const handleSetReminder = (medicationName: string) => {
    Alert.alert(
      "Set Reminder",
      `Would you like to set a reminder for ${medicationName}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Set Reminder",
          onPress: () => {
            setMessages((prev) => [
              ...prev,
              {
                id: Date.now().toString(),
                text: `✅ Reminder set for ${medicationName}. You'll be notified at the scheduled time.`,
                sender: "assistant",
                timestamp: new Date(),
              },
            ]);
          },
        },
      ],
    );
  };

  // ── Format time ───────────────────────────────────────────────────────────────
  const formatTime = (time?: string) => {
    if (!time) return "";
    if (!/^\d{1,2}:\d{2}$/.test(time)) return time;
    const [hours, minutes] = time.split(":");
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? "PM" : "AM";
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  };

  // ── Render message ────────────────────────────────────────────────────────────
  const renderMessage = (message: Message) => {
    const isUser = message.sender === "user";
    const safeData = Array.isArray(message.data) ? message.data : [];
    const safeInteractions = Array.isArray(message.data?.interactions)
      ? message.data.interactions
      : [];

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

          {/* Medication list */}
          {message.type === "medication" && message.data && (
            <View style={styles.messageData}>
              {safeData.map((med: any, index: number) => (
                <View key={index} style={styles.medicationItem}>
                  <View style={styles.medicationInfo}>
                    <Text style={styles.medicationName}>{med.name}</Text>
                    <Text style={styles.medicationDosage}>{med.dosage}</Text>
                    {med.time && (
                      <Text style={styles.medicationTime}>
                        {formatTime(med.time)}
                      </Text>
                    )}
                    {med.note && (
                      <Text
                        style={[
                          styles.medicationDosage,
                          { color: Colors.warning },
                        ]}
                      >
                        {med.note}
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

          {/* Health — interactions or metrics */}
          {message.type === "health" && message.data && (
            <View style={styles.messageData}>
              {message.data.interactions
                ? safeInteractions.map((interaction: any, index: number) => (
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
                  ))
                : safeData.map((metric: HealthMetric, index: number) => (
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

          {/* Suggestions / tips / emergency */}
          {message.type === "suggestion" && message.data && (
            <View style={styles.messageData}>
              {Array.isArray(message.data) ? (
                safeData.map((tip: string, index: number) => (
                  <View key={index} style={styles.tipItem}>
                    <Text style={styles.tipText}>{tip}</Text>
                  </View>
                ))
              ) : (
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

  // ── JSX ───────────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="medical" size={28} color={Colors.primary} />
          <Text style={styles.headerTitle}>AI Assistant</Text>
        </View>
        <View style={styles.headerRight}>
          {/* Green = profile loaded, Yellow = still loading */}
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor: isProfileReady
                  ? Colors.success
                  : Colors.warning,
              },
            ]}
          />
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

      {/* Messages + Input */}
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

        {/* Input bar */}
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

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
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
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerTitle: { fontSize: 20, fontWeight: "bold", color: Colors.text },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 12 },
  headerButton: { padding: 4 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  quickActionsContainer: {
    maxHeight: 80,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  quickActionsContent: { paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
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
  quickActionText: { fontSize: 14, color: Colors.primary, fontWeight: "500" },
  messagesContainer: { flex: 1 },
  messagesList: { flex: 1 },
  messagesContent: { paddingHorizontal: 16, paddingVertical: 20 },
  messageContainer: { flexDirection: "row", marginBottom: 16, maxWidth: "80%" },
  userMessageContainer: { alignSelf: "flex-end" },
  assistantMessageContainer: { alignSelf: "flex-start" },
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
  messageBubble: { borderRadius: 20, padding: 12, maxWidth: "100%" },
  userBubble: { backgroundColor: Colors.primary },
  assistantBubble: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  messageText: { fontSize: 16, lineHeight: 22, color: Colors.text },
  userMessageText: { color: Colors.surface },
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
  medicationInfo: { flex: 1 },
  medicationName: { fontSize: 14, fontWeight: "600", color: Colors.text },
  medicationDosage: { fontSize: 12, color: Colors.textSecondary },
  medicationTime: { fontSize: 11, color: Colors.primary, marginTop: 2 },
  takenButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: Colors.primary + "15",
    borderRadius: 16,
  },
  takenButtonActive: { backgroundColor: Colors.success + "20" },
  takenButtonText: { fontSize: 12, color: Colors.primary, fontWeight: "500" },
  refillButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: Colors.primary + "10",
    borderRadius: 16,
    gap: 4,
  },
  refillButtonText: { fontSize: 12, color: Colors.primary, fontWeight: "500" },
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
  interactionMeds: { fontSize: 14, fontWeight: "600", color: Colors.text },
  severityBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12 },
  severityText: {
    fontSize: 10,
    color: Colors.surface,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  interactionAdvice: { fontSize: 12, color: Colors.textSecondary },
  metricItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border + "20",
  },
  metricType: { fontSize: 14, color: Colors.text },
  metricValueContainer: { flexDirection: "row", alignItems: "center", gap: 4 },
  metricValue: { fontSize: 16, fontWeight: "600", color: Colors.text },
  metricUnit: { fontSize: 12, color: Colors.textSecondary, marginRight: 4 },
  tipItem: { paddingVertical: 6 },
  tipText: { fontSize: 14, color: Colors.text, lineHeight: 20 },
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
  emergencyLabel: { fontSize: 14, fontWeight: "600", color: Colors.text },
  emergencyNumber: { fontSize: 16, fontWeight: "bold", color: Colors.error },
  emergencyStepsTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.text,
    marginTop: 8,
    marginBottom: 4,
  },
  emergencyStep: { flexDirection: "row", gap: 8, marginBottom: 4 },
  emergencyStepNumber: {
    fontSize: 14,
    color: Colors.error,
    fontWeight: "600",
    width: 20,
  },
  emergencyStepText: { flex: 1, fontSize: 14, color: Colors.text },
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
  typingText: { fontSize: 14, color: Colors.textSecondary },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  attachButton: { padding: 8 },
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
  sendButtonDisabled: { backgroundColor: Colors.border },
});
