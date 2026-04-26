// app/(tabs)/scan.tsx
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import React, { useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Animated,
    Image,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Colors from "@/constants/colors";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ScannedMedicine {
  name: string | null;
  dosageMg: string | null;
  expirationDate: string | null;
  rawText: string;
  confidence: "high" | "low";
}

type ScanStatus = "idle" | "front_done" | "processing" | "done" | "error";

interface CapturedPhoto {
  base64: string;
  uri: string;
}

// ─── Config ──────────────────────────────────────────────────────────────────

const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY ?? "";

// ─── GPT-4o Vision — accepts 1 or 2 images ───────────────────────────────────

async function scanMedicineImages(
  front: CapturedPhoto,
  back?: CapturedPhoto,
): Promise<ScannedMedicine> {
  if (!OPENAI_API_KEY) throw new Error("OpenAI API key not set.");

  const imageBlocks: object[] = [
    {
      type: "image_url",
      image_url: {
        url: `data:image/jpeg;base64,${front.base64}`,
        detail: "high",
      },
    },
  ];

  if (back) {
    imageBlocks.push({
      type: "image_url",
      image_url: {
        url: `data:image/jpeg;base64,${back.base64}`,
        detail: "high",
      },
    });
  }

  const sides = back ? "two sides (front and back)" : "one side (front only)";

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a medicine packaging scanner. You will receive photos of ${sides} of medicine packaging.
Labels may be in English, Filipino (Tagalog), or a mix of both.
Combine information from all provided images to give the most complete result.
Always respond with valid JSON only. No explanation, no markdown.
If a field cannot be found in any of the images, set it to null.`,
        },
        {
          role: "user",
          content: [
            ...imageBlocks,
            {
              type: "text",
              text: `Look at ${back ? "these medicine packaging photos (front and back)" : "this medicine packaging photo"} and extract all medicine details.
Combine information from both sides if provided.
Return JSON with exactly these fields:
{
  "name": "brand name or generic name of the medicine",
  "dosageMg": "dosage strength e.g. 500mg, 10mg/5ml, 1g",
  "expirationDate": "expiration date in MM/YYYY or MM/DD/YYYY format",
  "rawText": "all visible text you can read from all the labels combined",
  "confidence": "high if clearly readable, low if blurry or partially visible"
}`,
            },
          ],
        },
      ],
    }),
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);

  const parsed = JSON.parse(data.choices[0].message.content ?? "{}");
  return parsed as ScannedMedicine;
}

// ─── Camera helper ────────────────────────────────────────────────────────────

async function openCamera(): Promise<CapturedPhoto | null> {
  const { status } = await ImagePicker.requestCameraPermissionsAsync();
  if (status !== "granted") {
    Alert.alert(
      "Camera Permission",
      "Camera access is required to scan medicine labels.",
    );
    return null;
  }

  const picked = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.92,
    base64: true,
    allowsEditing: false,
  });

  if (picked.canceled || !picked.assets?.[0]) return null;

  const asset = picked.assets[0];
  if (!asset.base64) throw new Error("Could not read image data.");

  return { base64: asset.base64, uri: asset.uri };
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [frontPhoto, setFrontPhoto] = useState<CapturedPhoto | null>(null);
  const [backPhoto, setBackPhoto] = useState<CapturedPhoto | null>(null);
  const [result, setResult] = useState<ScannedMedicine | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const startPulse = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.06,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    ).start();
  };

  const fadeInResult = () => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  };

  const reset = () => {
    setStatus("idle");
    setFrontPhoto(null);
    setBackPhoto(null);
    setResult(null);
    setError(null);
    fadeAnim.setValue(0);
    pulseAnim.setValue(1);
  };

  // ── Step 1: Capture front ─────────────────────────────────────────────────

  const handleCaptureFront = async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const photo = await openCamera();
      if (!photo) return;
      setFrontPhoto(photo);
      setStatus("front_done");
    } catch (err: any) {
      setError(err.message ?? "Something went wrong.");
      setStatus("error");
    }
  };

  // ── Step 2a: Capture back then process ───────────────────────────────────

  const handleCaptureBack = async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const photo = await openCamera();
      if (!photo) return;
      setBackPhoto(photo);
      await processImages(frontPhoto!, photo);
    } catch (err: any) {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
      setError(err.message ?? "Something went wrong.");
      setStatus("error");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  // ── Step 2b: Skip back, process front only ────────────────────────────────

  const handleSkipBack = async () => {
    await processImages(frontPhoto!, undefined);
  };

  // ── Core: send to GPT-4o ──────────────────────────────────────────────────

  const processImages = async (front: CapturedPhoto, back?: CapturedPhoto) => {
    try {
      setStatus("processing");
      startPulse();

      const medicine = await scanMedicineImages(front, back);

      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
      setResult(medicine);
      setStatus("done");
      fadeInResult();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
      setError(err.message ?? "Something went wrong.");
      setStatus("error");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  // ── UI ────────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Scan Medicine</Text>
        <Text style={styles.headerSub}>
          {status === "idle" && "Scan the front of the packaging to start"}
          {status === "front_done" && "Now scan the back, or skip to process"}
          {status === "processing" && "Analyzing your scans…"}
          {status === "done" && "Medicine identified successfully"}
          {status === "error" && "Something went wrong"}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Step indicator */}
        {(status === "idle" || status === "front_done") && (
          <View style={styles.stepRow}>
            <StepDot
              number={1}
              label="Front"
              state={status === "idle" ? "active" : "done"}
            />
            <View
              style={[
                styles.stepLine,
                status === "front_done" && styles.stepLineDone,
              ]}
            />
            <StepDot
              number={2}
              label="Back"
              state={status === "front_done" ? "active" : "pending"}
            />
          </View>
        )}

        {/* Photo previews */}
        {(status === "idle" || status === "front_done") && (
          <View style={styles.previewRow}>
            <PhotoSlot
              label="Front"
              uri={frontPhoto?.uri ?? null}
              isActive={status === "idle"}
            />
            <PhotoSlot
              label="Back"
              uri={backPhoto?.uri ?? null}
              isActive={status === "front_done"}
              optional
            />
          </View>
        )}

        {/* Scanner state card */}
        <View style={styles.scanCard}>
          <View style={[styles.corner, styles.tl]} />
          <View style={[styles.corner, styles.tr]} />
          <View style={[styles.corner, styles.bl]} />
          <View style={[styles.corner, styles.br]} />

          {status === "idle" && (
            <View style={styles.stateContent}>
              <Ionicons name="scan-outline" size={56} color={Colors.primary} />
              <Text style={styles.stateTitle}>Scan Front Label</Text>
              <Text style={styles.stateHint}>
                Point your camera at the front of the medicine packaging
              </Text>
            </View>
          )}

          {status === "front_done" && (
            <View style={styles.stateContent}>
              <Ionicons
                name="checkmark-circle-outline"
                size={56}
                color="#27AE60"
              />
              <Text style={styles.stateTitle}>Front Captured ✓</Text>
              <Text style={styles.stateHint}>
                Scan the back for expiration date, or skip if it&apos;s already
                visible
              </Text>
            </View>
          )}

          {status === "processing" && (
            <Animated.View
              style={[
                styles.stateContent,
                { transform: [{ scale: pulseAnim }] },
              ]}
            >
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text style={styles.stateTitle}>Reading label…</Text>
              <Text style={styles.stateHint}>
                {backPhoto
                  ? "Combining front and back info"
                  : "Extracting medicine details"}
              </Text>
            </Animated.View>
          )}

          {status === "error" && (
            <View style={styles.stateContent}>
              <Ionicons name="alert-circle-outline" size={56} color="#E74C3C" />
              <Text style={[styles.stateTitle, { color: "#E74C3C" }]}>
                Scan Failed
              </Text>
              <Text style={styles.stateHint}>{error}</Text>
            </View>
          )}
        </View>

        {/* Result card */}
        {status === "done" && result && (
          <Animated.View style={[styles.resultCard, { opacity: fadeAnim }]}>
            <View style={styles.resultHeader}>
              <Ionicons name="checkmark-circle" size={24} color="#27AE60" />
              <Text style={styles.resultHeaderText}>Medicine Detected</Text>
              {backPhoto && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>Front + Back</Text>
                </View>
              )}
              {result.confidence === "low" && (
                <View style={styles.lowConfidenceBadge}>
                  <Text style={styles.lowConfidenceText}>Low confidence</Text>
                </View>
              )}
            </View>

            <View style={styles.resultDivider} />

            <ResultRow
              icon="medkit-outline"
              label="Medicine Name"
              value={result.name}
            />
            <ResultRow
              icon="fitness-outline"
              label="Dosage"
              value={result.dosageMg}
            />
            <ResultRow
              icon="calendar-outline"
              label="Expiration Date"
              value={result.expirationDate}
            />

            {result.confidence === "low" && (
              <Text style={styles.confidenceWarning}>
                ⚠️ Some fields may be inaccurate. Please verify against the
                label.
              </Text>
            )}

            <View style={styles.resultActions}>
              <TouchableOpacity
                style={styles.addBtn}
                onPress={() => {
                  Alert.alert(
                    "Add Medicine",
                    `Add "${result.name ?? "this medicine"}" to your medications?`,
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Add",
                        onPress: () => {
                          /* your add logic here */
                        },
                      },
                    ],
                  );
                }}
              >
                <Ionicons name="add-circle-outline" size={18} color="#fff" />
                <Text style={styles.addBtnText}>Add to My Medicines</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.scanAgainBtn} onPress={reset}>
                <Ionicons
                  name="refresh-outline"
                  size={18}
                  color={Colors.primary}
                />
                <Text style={styles.scanAgainText}>Scan Again</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        )}

        {/* Tips */}
        {status === "idle" && (
          <View style={styles.tipsCard}>
            <Text style={styles.tipsTitle}>Tips for best results</Text>
            <TipRow icon="sunny-outline" text="Good lighting is key" />
            <TipRow
              icon="eye-outline"
              text="Keep the label flat and unfolded"
            />
            <TipRow
              icon="expand-outline"
              text="Fill the frame with the label text"
            />
            <TipRow
              icon="language-outline"
              text="Works with English and Filipino labels"
            />
          </View>
        )}
      </ScrollView>

      {/* Bottom action buttons */}
      <View
        style={[styles.fabContainer, { paddingBottom: insets.bottom + 80 }]}
      >
        {status === "idle" && (
          <TouchableOpacity
            style={styles.fab}
            onPress={handleCaptureFront}
            activeOpacity={0.85}
          >
            <Ionicons name="camera-outline" size={22} color="#fff" />
            <Text style={styles.fabText}>Scan Front</Text>
          </TouchableOpacity>
        )}

        {status === "front_done" && (
          <View style={styles.dualButtons}>
            <TouchableOpacity
              style={[styles.fab, styles.fabSecondary]}
              onPress={handleSkipBack}
              activeOpacity={0.85}
            >
              <Ionicons
                name="play-skip-forward-outline"
                size={20}
                color={Colors.primary}
              />
              <Text style={[styles.fabText, { color: Colors.primary }]}>
                Skip Back
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.fab, styles.fabPrimary]}
              onPress={handleCaptureBack}
              activeOpacity={0.85}
            >
              <Ionicons name="camera-outline" size={20} color="#fff" />
              <Text style={styles.fabText}>Scan Back</Text>
            </TouchableOpacity>
          </View>
        )}

        {status === "error" && (
          <TouchableOpacity
            style={styles.fab}
            onPress={reset}
            activeOpacity={0.85}
          >
            <Ionicons name="refresh-outline" size={22} color="#fff" />
            <Text style={styles.fabText}>Start Over</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepDot({
  number,
  label,
  state,
}: {
  number: number;
  label: string;
  state: "pending" | "active" | "done";
}) {
  const isDone = state === "done";
  const isActive = state === "active";
  return (
    <View style={styles.stepDotWrapper}>
      <View
        style={[
          styles.stepDot,
          isActive && styles.stepDotActive,
          isDone && styles.stepDotDone,
        ]}
      >
        {isDone ? (
          <Ionicons name="checkmark" size={13} color="#fff" />
        ) : (
          <Text style={[styles.stepDotNum, isActive && { color: "#fff" }]}>
            {number}
          </Text>
        )}
      </View>
      <Text
        style={[
          styles.stepDotLabel,
          isActive && { color: Colors.primary, fontWeight: "600" },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

function PhotoSlot({
  label,
  uri,
  isActive,
  optional,
}: {
  label: string;
  uri: string | null;
  isActive: boolean;
  optional?: boolean;
}) {
  return (
    <View style={[styles.photoSlot, isActive && styles.photoSlotActive]}>
      {uri ? (
        <Image
          source={{ uri }}
          style={styles.photoPreview}
          resizeMode="cover"
        />
      ) : (
        <View style={styles.photoPlaceholder}>
          <Ionicons
            name={isActive ? "camera-outline" : "image-outline"}
            size={28}
            color={isActive ? Colors.primary : "#CCC"}
          />
        </View>
      )}
      <Text
        style={[
          styles.photoLabel,
          uri ? { color: "#27AE60", fontWeight: "600" } : {},
        ]}
      >
        {uri ? `${label} ✓` : `${label}${optional ? " (optional)" : ""}`}
      </Text>
    </View>
  );
}

function ResultRow({
  icon,
  label,
  value,
}: {
  icon: any;
  label: string;
  value: string | null;
}) {
  return (
    <View style={styles.resultRow}>
      <Ionicons
        name={icon}
        size={18}
        color={Colors.primary}
        style={styles.resultRowIcon}
      />
      <View style={styles.resultRowText}>
        <Text style={styles.resultRowLabel}>{label}</Text>
        <Text style={[styles.resultRowValue, !value && styles.resultRowNull]}>
          {value ?? "Not found"}
        </Text>
      </View>
    </View>
  );
}

function TipRow({ icon, text }: { icon: any; text: string }) {
  return (
    <View style={styles.tipRow}>
      <Ionicons name={icon} size={16} color={Colors.primary} />
      <Text style={styles.tipText}>{text}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const CORNER_SIZE = 22;
const CORNER_THICK = 3;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F7F8FC" },
  header: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 12 },
  headerTitle: {
    fontSize: 26,
    fontWeight: "700",
    color: "#1A1A2E",
    letterSpacing: -0.5,
  },
  headerSub: { fontSize: 14, color: "#888", marginTop: 3 },
  content: { paddingHorizontal: 20, paddingBottom: 180, gap: 16 },

  // Step indicator
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  stepDotWrapper: { alignItems: "center", gap: 4 },
  stepDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#E8E8F0",
    alignItems: "center",
    justifyContent: "center",
  },
  stepDotActive: { backgroundColor: Colors.primary },
  stepDotDone: { backgroundColor: "#27AE60" },
  stepDotNum: { fontSize: 13, fontWeight: "700", color: "#999" },
  stepDotLabel: { fontSize: 12, color: "#999" },
  stepLine: {
    width: 60,
    height: 2,
    backgroundColor: "#E8E8F0",
    marginBottom: 14,
  },
  stepLineDone: { backgroundColor: "#27AE60" },

  // Photo previews
  previewRow: { flexDirection: "row", gap: 12 },
  photoSlot: {
    flex: 1,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: "#E8E8F0",
    alignItems: "center",
  },
  photoSlotActive: { borderColor: Colors.primary, borderStyle: "dashed" },
  photoPreview: { width: "100%", height: 110 },
  photoPlaceholder: {
    width: "100%",
    height: 110,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F7F8FC",
  },
  photoLabel: { fontSize: 12, color: "#999", paddingVertical: 8 },

  // Scanner card
  scanCard: {
    backgroundColor: "#fff",
    borderRadius: 20,
    minHeight: 200,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
    position: "relative",
  },
  corner: {
    position: "absolute",
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderColor: Colors.primary,
  },
  tl: {
    top: 14,
    left: 14,
    borderTopWidth: CORNER_THICK,
    borderLeftWidth: CORNER_THICK,
    borderTopLeftRadius: 6,
  },
  tr: {
    top: 14,
    right: 14,
    borderTopWidth: CORNER_THICK,
    borderRightWidth: CORNER_THICK,
    borderTopRightRadius: 6,
  },
  bl: {
    bottom: 14,
    left: 14,
    borderBottomWidth: CORNER_THICK,
    borderLeftWidth: CORNER_THICK,
    borderBottomLeftRadius: 6,
  },
  br: {
    bottom: 14,
    right: 14,
    borderBottomWidth: CORNER_THICK,
    borderRightWidth: CORNER_THICK,
    borderBottomRightRadius: 6,
  },
  stateContent: { alignItems: "center", gap: 10 },
  stateTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#1A1A2E",
    marginTop: 4,
  },
  stateHint: {
    fontSize: 13,
    color: "#999",
    textAlign: "center",
    lineHeight: 19,
  },
  retryBtn: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: "#FEE8E6",
  },
  retryBtnText: { color: "#E74C3C", fontWeight: "600", fontSize: 14 },

  // Result card
  resultCard: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 20,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  resultHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  resultHeaderText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1A1A2E",
    flex: 1,
  },
  badge: {
    backgroundColor: "#E8F5E9",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeText: { fontSize: 11, color: "#27AE60", fontWeight: "600" },
  lowConfidenceBadge: {
    backgroundColor: "#FFF3CD",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  lowConfidenceText: { fontSize: 11, color: "#856404", fontWeight: "600" },
  resultDivider: { height: 1, backgroundColor: "#F0F0F5", marginVertical: 14 },
  resultRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 14,
    gap: 12,
  },
  resultRowIcon: { marginTop: 2 },
  resultRowText: { flex: 1 },
  resultRowLabel: { fontSize: 12, color: "#999", marginBottom: 2 },
  resultRowValue: { fontSize: 15, fontWeight: "600", color: "#1A1A2E" },
  resultRowNull: { color: "#CCC", fontStyle: "italic", fontWeight: "400" },
  confidenceWarning: {
    fontSize: 12,
    color: "#856404",
    backgroundColor: "#FFF3CD",
    padding: 10,
    borderRadius: 10,
    marginBottom: 14,
    lineHeight: 17,
  },
  resultActions: { gap: 10, marginTop: 4 },
  addBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  addBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  scanAgainBtn: {
    borderRadius: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  scanAgainText: { color: Colors.primary, fontWeight: "600", fontSize: 14 },

  // Tips
  tipsCard: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 20,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
    gap: 10,
  },
  tipsTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1A1A2E",
    marginBottom: 4,
  },
  tipRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  tipText: { fontSize: 13, color: "#666" },

  // FAB
  fabContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    paddingHorizontal: 20,
  },
  dualButtons: { flexDirection: "row", gap: 10, width: "100%" },
  fab: {
    flex: 1,
    backgroundColor: Colors.primary,
    borderRadius: 30,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    shadowColor: Colors.primary,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    justifyContent: "center",
  },
  fabPrimary: { backgroundColor: Colors.primary },
  fabSecondary: {
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: Colors.primary,
    shadowColor: "#000",
    shadowOpacity: 0.06,
  },
  fabText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
