// app/(tabs)/scan.tsx
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Colors from "@/constants/colors";
import { auth, db } from "@/lib/firebase";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ScannedMedicine {
  isMedicine: boolean;
  name: string | null;
  dosageMg: string | null;
  expirationDate: string | null;
  rawText: string;
  confidence: "high" | "low";
}

type ScanStatus =
  | "idle"
  | "front_done"
  | "processing"
  | "retrying"
  | "done"
  | "not_medicine"
  | "error";

interface CapturedPhoto {
  base64: string;
  uri: string;
}

function getConfidenceScore(confidence: "high" | "low", wasRetried: boolean) {
  if (confidence === "high" && wasRetried) return 95;
  if (confidence === "high") return 85;
  if (confidence === "low" && wasRetried) return 70;
  return 55;
}

// ─── Expiration helpers ───────────────────────────────────────────────────────

/**
 * Parses MM/YYYY or MM/DD/YYYY (with optional trailing ?) into a Date.
 * Returns null if unparseable.
 */
function parseExpirationDate(raw: string | null): Date | null {
  if (!raw) return null;
  const clean = raw.replace(/\?$/, "").trim();

  // MM/YYYY
  const mmyyyy = clean.match(/^(\d{1,2})\/(\d{4})$/);
  if (mmyyyy) {
    const month = parseInt(mmyyyy[1], 10) - 1;
    const year = parseInt(mmyyyy[2], 10);
    // Expires at the END of that month
    return new Date(year, month + 1, 0);
  }

  // MM/DD/YYYY
  const mmddyyyy = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mmddyyyy) {
    const month = parseInt(mmddyyyy[1], 10) - 1;
    const day = parseInt(mmddyyyy[2], 10);
    const year = parseInt(mmddyyyy[3], 10);
    return new Date(year, month, day);
  }

  return null;
}

function isMedicationExpired(expirationDate: string | null): boolean {
  const expDate = parseExpirationDate(expirationDate);
  if (!expDate) return false;
  return expDate < new Date();
}

// ─── Config ──────────────────────────────────────────────────────────────────

const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY ?? "";

// ─── GPT-4o Vision — first pass ──────────────────────────────────────────────

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
If a field cannot be found in any of the images, set it to null.
If the image is NOT medicine packaging (e.g. food, household item, random object, blank surface), set isMedicine to false and all other fields to null.`,
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
  "isMedicine": true or false — is this actually medicine packaging?,
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

// ─── GPT-4o Vision — dark-text fallback retry ────────────────────────────────

async function retryWithEnhancedPrompt(
  front: CapturedPhoto,
  back?: CapturedPhoto,
  previousRawText?: string,
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

  const contextHint = previousRawText
    ? `A previous scan attempt read this partial text from the label: "${previousRawText}". Use it as context to help fill in any gaps.`
    : "";

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
          content: `You are an expert at reading difficult medicine labels — including dark backgrounds, embossed text, foil printing, blurry photos, and low-contrast ink.
Your job is to extract medicine information even when the image quality is poor.
Labels may be in English, Filipino (Tagalog), or both.
${contextHint}
Strategies to use:
- Look for embossed or debossed date stamps (especially on blister packs or bottle necks)
- Expiration dates are often printed as "EXP", "Best Before", "Exp. Date", "Petsa ng Pagkasira", or stamped directly onto foil
- Look at the edges, bottom, and seams of packaging where dates are often inkjet-printed
- For dark labels, look for any slight contrast difference that could be text
- Generic medicine names often appear in smaller print below the brand name
- Dosage may appear as mg, mcg, g, ml, IU, or % strength

Always respond with valid JSON only. No explanation, no markdown.`,
        },
        {
          role: "user",
          content: [
            ...imageBlocks,
            {
              type: "text",
              text: `This is a second attempt to read a medicine label that was difficult to scan. Please try harder to read any dark, embossed, or low-contrast text.
Pay special attention to expiration dates — check all edges, seams, and bottoms of the packaging.
Return JSON with exactly these fields:
{
  "isMedicine": true or false,
  "name": "brand or generic medicine name",
  "dosageMg": "dosage strength",
  "expirationDate": "expiration date in MM/YYYY or MM/DD/YYYY — if uncertain write your best guess with a ? suffix e.g. 03/2026?",
  "rawText": "all text you can read including partial characters",
  "confidence": "high or low"
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

// ─── Firestore — save medication ─────────────────────────────────────────────

/**
 * Parses a dosage string like "500mg", "10mg/5ml", "1g" into
 * { amount: number, unit: string }.
 */
function parseDosage(dosageMg: string | null): {
  dosageAmount: number;
  dosageUnit: string;
} {
  if (!dosageMg) return { dosageAmount: 0, dosageUnit: "mg" };

  const match = dosageMg.match(/^([\d.]+)\s*([a-zA-Z/]+)/);
  if (match) {
    return {
      dosageAmount: parseFloat(match[1]),
      dosageUnit: match[2].toLowerCase(),
    };
  }
  return { dosageAmount: 0, dosageUnit: "mg" };
}

async function saveMedicationToFirestore(
  result: ScannedMedicine,
): Promise<void> {
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error("You must be logged in to add medications.");

  const { dosageAmount, dosageUnit } = parseDosage(result.dosageMg);

  await addDoc(collection(db, "users", userId, "medications"), {
    name: result.name ?? "Unknown Medication",
    generic_name: result.name ?? "",
    dosageAmount,
    dosageUnit,
    drug_id: "",
    drug_ids: [],
    ingredients: [],
    is_combination: false,
    active: true,
    quantity: 1,
    notes: result.expirationDate ? `Expiration: ${result.expirationDate}` : "",
    refillReminder: false,
    scannedFromLabel: true,
    rawLabelText: result.rawText ?? "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [frontPhoto, setFrontPhoto] = useState<CapturedPhoto | null>(null);
  const [backPhoto, setBackPhoto] = useState<CapturedPhoto | null>(null);
  const [result, setResult] = useState<ScannedMedicine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wasRetried, setWasRetried] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showExpiredModal, setShowExpiredModal] = useState(false);

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
    setWasRetried(false);
    setIsSaving(false);
    setShowExpiredModal(false);
    fadeAnim.setValue(0);
    pulseAnim.setValue(1);
  };

  // ── Add to medications ────────────────────────────────────────────────────

  const handleAddMedication = async () => {
    if (!result) return;

    // Block if expired
    if (isMedicationExpired(result.expirationDate)) {
      setShowExpiredModal(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    try {
      setIsSaving(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await saveMedicationToFirestore(result);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        "Medication Added",
        `${result.name ?? "Medication"} has been added to your medications.`,
        [{ text: "OK", onPress: reset }],
      );
    } catch (err: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Error", err.message ?? "Failed to save medication.");
    } finally {
      setIsSaving(false);
    }
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

  // ── Core: send to GPT-4o with optional dark-text retry ───────────────────

  const processImages = async (front: CapturedPhoto, back?: CapturedPhoto) => {
    try {
      setStatus("processing");
      setWasRetried(false);
      startPulse();

      let medicine = await scanMedicineImages(front, back);

      if (!medicine.isMedicine) {
        pulseAnim.stopAnimation();
        pulseAnim.setValue(1);
        setResult(medicine);
        setStatus("not_medicine");
        fadeInResult();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      }

      if (medicine.confidence === "low") {
        setStatus("retrying");
        const retry = await retryWithEnhancedPrompt(
          front,
          back,
          medicine.rawText,
        );
        setWasRetried(true);

        medicine = {
          isMedicine: retry.isMedicine ?? medicine.isMedicine,
          name: retry.name ?? medicine.name,
          dosageMg: retry.dosageMg ?? medicine.dosageMg,
          expirationDate: retry.expirationDate ?? medicine.expirationDate,
          rawText: retry.rawText || medicine.rawText,
          confidence: retry.confidence,
        };

        if (!medicine.isMedicine) {
          pulseAnim.stopAnimation();
          pulseAnim.setValue(1);
          setResult(medicine);
          setStatus("not_medicine");
          fadeInResult();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          return;
        }
      }

      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
      setResult(medicine);
      setStatus("done");
      fadeInResult();

      // Auto-show expired modal right after scan completes
      if (isMedicationExpired(medicine.expirationDate)) {
        setShowExpiredModal(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err: any) {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
      setError(err.message ?? "Something went wrong.");
      setStatus("error");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  // ── Derived state ─────────────────────────────────────────────────────────

  const isProcessing = status === "processing" || status === "retrying";
  const isExpired = result ? isMedicationExpired(result.expirationDate) : false;

  // ── UI ────────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* ── Expired medication modal ───────────────────────────────────────── */}
      <Modal
        visible={showExpiredModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowExpiredModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalIconWrap}>
              <Ionicons name="warning" size={40} color="#E74C3C" />
            </View>
            <Text style={styles.modalTitle}>Expired Medication</Text>
            <Text style={styles.modalBody}>
              Do not take this medication.{"\n"}It has passed its expiration
              date
              {result?.expirationDate ? ` (${result.expirationDate})` : ""} and
              may be ineffective or harmful.
            </Text>
            <Text style={styles.modalAdvice}>
              Please dispose of it safely and consult your pharmacist for a
              replacement.
            </Text>
            <TouchableOpacity
              style={styles.modalBtn}
              onPress={() => setShowExpiredModal(false)}
            >
              <Text style={styles.modalBtnText}>I Understand</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Scan Medicine</Text>
        <Text style={styles.headerSub}>
          {status === "idle" && "Scan the front of the packaging to start"}
          {status === "front_done" && "Now scan the back, or skip to process"}
          {status === "processing" && "Analyzing your scans…"}
          {status === "retrying" && "Enhancing scan for hard-to-read text…"}
          {status === "done" && "Medicine identified successfully"}
          {status === "not_medicine" && "No medicine packaging detected"}
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
        <View
          style={[
            styles.scanCard,
            status === "done" && styles.scanCardDone,
            status === "done" && isExpired && styles.scanCardExpired,
          ]}
        >
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

          {status === "retrying" && (
            <Animated.View
              style={[
                styles.stateContent,
                { transform: [{ scale: pulseAnim }] },
              ]}
            >
              <ActivityIndicator size="large" color="#F39C12" />
              <Text style={styles.stateTitle}>Enhancing scan…</Text>
              <Text style={styles.stateHint}>
                Text was hard to read — trying again with a deeper analysis
              </Text>
            </Animated.View>
          )}

          {status === "done" && frontPhoto && (
            <View style={styles.scanCardDoneContent}>
              <Image
                source={{ uri: frontPhoto.uri }}
                style={styles.scanCardDoneImage}
                resizeMode="cover"
              />
              <View style={styles.scanCardOverlay} />
              {isExpired ? (
                <View style={styles.scanCardBadgeExpired}>
                  <Ionicons name="warning" size={15} color="#fff" />
                  <Text style={styles.scanCardBadgeText}>Expired</Text>
                </View>
              ) : (
                <View style={styles.scanCardBadge}>
                  <Ionicons name="checkmark-circle" size={15} color="#fff" />
                  <Text style={styles.scanCardBadgeText}>Scanned</Text>
                </View>
              )}
            </View>
          )}

          {status === "not_medicine" && (
            <View style={styles.stateContent}>
              <Ionicons name="close-circle-outline" size={56} color="#E74C3C" />
              <Text style={[styles.stateTitle, { color: "#E74C3C" }]}>
                Not a Medicine
              </Text>
              <Text style={styles.stateHint}>
                No medicine packaging was detected in the photo. Please scan a
                medicine label.
              </Text>
            </View>
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
              <Ionicons
                name={isExpired ? "warning" : "checkmark-circle"}
                size={24}
                color={isExpired ? "#E74C3C" : "#27AE60"}
              />
              <Text style={styles.resultHeaderText}>
                {isExpired ? "Expired Medication" : "Medicine Detected"}
              </Text>
              {backPhoto && !isExpired && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>Front + Back</Text>
                </View>
              )}
              {wasRetried && !isExpired && (
                <View style={styles.retriedBadge}>
                  <Text style={styles.retriedBadgeText}>Enhanced Scan</Text>
                </View>
              )}
              {isExpired && (
                <View style={styles.expiredBadge}>
                  <Text style={styles.expiredBadgeText}>EXPIRED</Text>
                </View>
              )}
              {result.confidence === "low" && !isExpired && (
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
              isExpired={isExpired}
            />

            {/* Expired warning banner */}
            {isExpired && (
              <View style={styles.expiredBanner}>
                <Ionicons name="warning" size={16} color="#E74C3C" />
                <Text style={styles.expiredBannerText}>
                  This medication has expired and cannot be added to your
                  medications. Please dispose of it safely.
                </Text>
              </View>
            )}

            {result.confidence === "low" && !isExpired && (
              <Text style={styles.confidenceWarning}>
                ⚠️ Some fields may be inaccurate. Please verify against the
                label.
              </Text>
            )}

            {wasRetried && result.confidence === "high" && !isExpired && (
              <Text style={styles.enhancedNote}>
                ✨ Enhanced scan recovered additional details from hard-to-read
                text.
              </Text>
            )}

            <View style={styles.resultActions}>
              {/* Add to Medications — disabled when expired */}
              <TouchableOpacity
                style={[styles.addBtn, isExpired && styles.addBtnDisabled]}
                onPress={handleAddMedication}
                disabled={isExpired || isSaving}
                activeOpacity={isExpired ? 1 : 0.8}
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons
                    name={isExpired ? "ban-outline" : "add-circle-outline"}
                    size={20}
                    color="#fff"
                  />
                )}
                <Text style={styles.addBtnText}>
                  {isSaving
                    ? "Saving…"
                    : isExpired
                      ? "Cannot Add — Expired"
                      : "Add to Medications"}
                </Text>
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

        {/* Not medicine — action card */}
        {status === "not_medicine" && (
          <Animated.View
            style={[styles.notMedicineCard, { opacity: fadeAnim }]}
          >
            <Text style={styles.notMedicineTitle}>What to try</Text>
            <TipRow
              icon="medkit-outline"
              text="Make sure you're scanning a medicine box, bottle, or blister pack"
            />
            <TipRow
              icon="text-outline"
              text="Aim at the side with the most text, including the brand name"
            />
            <TipRow
              icon="sunny-outline"
              text="Improve lighting so the label is clearly visible"
            />
            <TouchableOpacity style={styles.scanAgainBtn} onPress={reset}>
              <Ionicons
                name="refresh-outline"
                size={18}
                color={Colors.primary}
              />
              <Text style={styles.scanAgainText}>Try Again</Text>
            </TouchableOpacity>
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

        {(status === "error" || status === "not_medicine") && (
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
  isExpired,
}: {
  icon: any;
  label: string;
  value: string | null;
  isExpired?: boolean;
}) {
  const isExpiredField = label === "Expiration Date" && isExpired;
  return (
    <View style={styles.resultRow}>
      <Ionicons
        name={icon}
        size={18}
        color={isExpiredField ? "#E74C3C" : Colors.primary}
        style={styles.resultRowIcon}
      />
      <View style={styles.resultRowText}>
        <Text style={styles.resultRowLabel}>{label}</Text>
        <Text
          style={[
            styles.resultRowValue,
            !value && styles.resultRowNull,
            isExpiredField && styles.resultRowExpired,
          ]}
        >
          {value ?? "Not found"}
          {isExpiredField ? " ⚠️" : ""}
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
    overflow: "hidden",
  },
  scanCardDone: {
    height: 220,
    padding: 0,
  },
  scanCardExpired: {
    borderWidth: 2,
    borderColor: "#E74C3C",
  },
  scanCardDoneContent: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  scanCardDoneImage: {
    width: "100%",
    height: "100%",
  },
  scanCardOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  scanCardBadge: {
    position: "absolute",
    bottom: 14,
    right: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(39,174,96,0.88)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  scanCardBadgeExpired: {
    position: "absolute",
    bottom: 14,
    right: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(231,76,60,0.90)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  scanCardBadgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
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
  retriedBadge: {
    backgroundColor: "#FFF3E0",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  retriedBadgeText: { fontSize: 11, color: "#E65100", fontWeight: "600" },
  expiredBadge: {
    backgroundColor: "#FDECEA",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  expiredBadgeText: { fontSize: 11, color: "#E74C3C", fontWeight: "700" },
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
  resultRowExpired: { color: "#E74C3C" },

  // Expired banner
  expiredBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "#FDECEA",
    borderWidth: 1,
    borderColor: "#F5C6CB",
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  expiredBannerText: {
    flex: 1,
    fontSize: 13,
    color: "#C0392B",
    lineHeight: 18,
  },

  confidenceWarning: {
    fontSize: 12,
    color: "#856404",
    backgroundColor: "#FFF3CD",
    padding: 10,
    borderRadius: 10,
    marginBottom: 14,
    lineHeight: 17,
  },
  enhancedNote: {
    fontSize: 12,
    color: "#1B5E20",
    backgroundColor: "#E8F5E9",
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
  addBtnDisabled: {
    backgroundColor: "#CCC",
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

  // Not medicine card
  notMedicineCard: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 20,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
    gap: 12,
  },
  notMedicineTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1A1A2E",
    marginBottom: 4,
  },

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
  tipText: { fontSize: 13, color: "#666", flex: 1 },

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
    paddingHorizontal: 18,
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

  // Expired modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 28,
    alignItems: "center",
    width: "100%",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 10,
  },
  modalIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#FDECEA",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#C0392B",
    marginBottom: 12,
    textAlign: "center",
  },
  modalBody: {
    fontSize: 15,
    color: "#333",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 10,
  },
  modalAdvice: {
    fontSize: 13,
    color: "#888",
    textAlign: "center",
    lineHeight: 19,
    marginBottom: 24,
  },
  modalBtn: {
    backgroundColor: "#E74C3C",
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 40,
    alignItems: "center",
  },
  modalBtnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15,
  },
});
