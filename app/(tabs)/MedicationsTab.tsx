// app/(tabs)/MedicationsTab.tsx
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Colors from "../../constants/colors";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Medication {
  id: string;
  name: string;
  drug_ids?: string[];
  drug_id?: string;
  dosageAmount?: number;
  dosageUnit?: string;
  generic_name?: string;
  quantity: number;
  active: boolean;
  is_combination?: boolean;
  ingredients?: string[];
  refillReminder?: boolean;
  refillThreshold?: number;
}

interface Reminder {
  id: string;
  medicationId: string;
}

interface MedicationsTabProps {
  medications: Medication[];
  searchQuery: string;
  reminders: Reminder[];
  onAddReminder: () => void;
  onEditMedication: (medication: Medication) => void;
  onDeleteMedication: (id: string) => void;
  isCaregiver?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  canManageReminders?: boolean;
}

// ─── Scanned result from GPT-4o ───────────────────────────────────────────────

interface ScannedMedicine {
  isMedicine: boolean;
  name: string | null;
  dosageMg: string | null;
  expirationDate: string | null;
  rawText: string;
  confidence: "high" | "low";
}

interface CapturedPhoto {
  base64: string;
  uri: string;
}

// Scan flow steps: idle → front_done (optional back) → scanning → done/error
type ScanStep = "idle" | "front_done" | "scanning" | "done" | "error";

type VerifyStatus = "idle" | "scanning" | "done" | "error";

interface VerifyResult {
  scannedName: string | null;
  scannedDosage: string | null;
  scannedExpiration: string | null;
  nameMatch: boolean;
  dosageMatch: boolean;
  isExpired: boolean;
  confidence: "high" | "low";
  rawText: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY ?? "";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getDosageDisplay = (medication: Medication): string => {
  if (medication.dosageAmount !== undefined) {
    const unit = medication.dosageUnit || "mg";
    return `${medication.dosageAmount} ${unit}`;
  }
  return "No dosage set";
};

const normaliseName = (s: string | null | undefined): string =>
  (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const namesMatch = (stored: string, scanned: string | null): boolean => {
  if (!scanned) return false;
  const a = normaliseName(stored);
  const b = normaliseName(scanned);
  if (a === b) return true;
  const tokensA = a.split(" ").filter((t) => t.length > 2);
  const tokensB = b.split(" ").filter((t) => t.length > 2);
  return tokensA.some((t) => tokensB.includes(t));
};

const dosagesMatch = (
  medication: Medication,
  scannedDosage: string | null,
): boolean => {
  if (!scannedDosage || medication.dosageAmount === undefined) return false;
  const unit = (medication.dosageUnit ?? "mg").toLowerCase();
  const amount = String(medication.dosageAmount);
  const normalised = scannedDosage.toLowerCase().replace(/\s/g, "");
  return (
    normalised.includes(`${amount}${unit}`) ||
    normalised.includes(`${amount} ${unit}`)
  );
};

// ─── Expiration helpers (ported from scan.tsx) ────────────────────────────────

function parseExpirationDate(raw: string | null): Date | null {
  if (!raw) return null;
  const clean = raw.replace(/\?$/, "").trim();

  // MM/YYYY
  const mmyyyy = clean.match(/^(\d{1,2})\/(\d{4})$/);
  if (mmyyyy) {
    const month = parseInt(mmyyyy[1], 10) - 1;
    const year = parseInt(mmyyyy[2], 10);
    return new Date(year, month + 1, 0); // last day of that month
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

// ─── GPT-4o scan (supports front + optional back) ────────────────────────────

async function scanLabelForVerification(
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
          content: `You are a medicine label scanner. You will receive photos of ${sides} of medicine packaging.
Labels may be in English or Filipino (Tagalog).
Combine information from all provided images to give the most complete result.
Always respond with valid JSON only. No explanation, no markdown.`,
        },
        {
          role: "user",
          content: [
            ...imageBlocks,
            {
              type: "text",
              text: `Extract medicine details and return JSON with exactly these fields:
{
  "isMedicine": true or false,
  "name": "brand or generic medicine name",
  "dosageMg": "dosage strength e.g. 500mg, 10mg/5ml",
  "expirationDate": "MM/YYYY or MM/DD/YYYY or null",
  "rawText": "all visible text from the label",
  "confidence": "high if clearly readable, low if blurry or partial"
}`,
            },
          ],
        },
      ],
    }),
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return JSON.parse(data.choices[0].message.content ?? "{}") as ScannedMedicine;
}

// ─── Camera helper ────────────────────────────────────────────────────────────

async function openCamera(): Promise<CapturedPhoto | null> {
  const { status } = await ImagePicker.requestCameraPermissionsAsync();
  if (status !== "granted") {
    Alert.alert("Camera Permission", "Camera access is needed to scan labels.");
    return null;
  }
  const picked = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.92,
    base64: true,
    allowsEditing: false,
  });
  if (picked.canceled || !picked.assets?.[0]?.base64) return null;
  const asset = picked.assets[0];
  return { base64: asset.base64!, uri: asset.uri };
}

// ─── Expired Modal ────────────────────────────────────────────────────────────

interface ExpiredModalProps {
  visible: boolean;
  expirationDate: string | null;
  onClose: () => void;
}

function ExpiredModal({ visible, expirationDate, onClose }: ExpiredModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={eStyles.overlay}>
        <View style={eStyles.card}>
          <View style={eStyles.iconWrap}>
            <Ionicons name="warning" size={40} color="#E74C3C" />
          </View>
          <Text style={eStyles.title}>Expired Medication</Text>
          <Text style={eStyles.body}>
            Do not take this medication.{"\n"}It has passed its expiration date
            {expirationDate ? ` (${expirationDate})` : ""} and may be
            ineffective or harmful.
          </Text>
          <Text style={eStyles.advice}>
            Please dispose of it safely and consult your pharmacist for a
            replacement.
          </Text>
          <TouchableOpacity style={eStyles.btn} onPress={onClose}>
            <Text style={eStyles.btnText}>I Understand</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Verify Modal ─────────────────────────────────────────────────────────────

interface VerifyModalProps {
  visible: boolean;
  medication: Medication | null;
  verifyStatus: VerifyStatus;
  scanStep: ScanStep;
  frontPhoto: CapturedPhoto | null;
  result: VerifyResult | null;
  error: string | null;
  showExpiredModal: boolean;
  onClose: () => void;
  onCaptureFront: () => void;
  onCaptureBack: () => void;
  onSkipBack: () => void;
  onScanAgain: () => void;
  onCloseExpired: () => void;
}

function VerifyModal({
  visible,
  medication,
  scanStep,
  result,
  error,
  showExpiredModal,
  onClose,
  onCaptureFront,
  onCaptureBack,
  onSkipBack,
  onScanAgain,
  onCloseExpired,
}: VerifyModalProps) {
  if (!medication) return null;

  const isExpired = result?.isExpired ?? false;
  const isFullMatch = result?.nameMatch && result?.dosageMatch;
  const isPartialMatch = result?.nameMatch && !result?.dosageMatch;

  const matchColor = isExpired
    ? "#E74C3C"
    : isFullMatch
      ? "#27AE60"
      : isPartialMatch
        ? "#F39C12"
        : "#E74C3C";

  const matchIcon: any = isExpired
    ? "warning"
    : isFullMatch
      ? "checkmark-circle"
      : isPartialMatch
        ? "alert-circle"
        : "close-circle";

  const matchTitle = isExpired
    ? "Expired Medication ⚠️"
    : isFullMatch
      ? "Correct Medication ✓"
      : isPartialMatch
        ? "Name Matches — Dosage Differs"
        : "Wrong Medication";

  const matchMessage = isExpired
    ? `This medication expired on ${result?.scannedExpiration ?? "an unknown date"}. Do not take it — dispose of it safely.`
    : isFullMatch
      ? `The scanned label matches ${medication.name}. Safe to take.`
      : isPartialMatch
        ? `The medicine name matches but the dosage on the label (${result?.scannedDosage ?? "unknown"}) differs from your record (${getDosageDisplay(medication)}). Please double-check.`
        : `The scanned label appears to be "${result?.scannedName ?? "unknown"}", not "${medication.name}". Do not take this medication.`;

  return (
    <>
      {/* Expired sub-modal (renders on top) */}
      <ExpiredModal
        visible={showExpiredModal}
        expirationDate={result?.scannedExpiration ?? null}
        onClose={onCloseExpired}
      />

      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={onClose}
      >
        <View style={mStyles.overlay}>
          <View style={mStyles.sheet}>
            {/* Handle */}
            <View style={mStyles.handle} />

            {/* Header */}
            <View style={mStyles.header}>
              <Text style={mStyles.headerTitle}>Verify Medication</Text>
              <TouchableOpacity
                onPress={onClose}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="close" size={22} color="#666" />
              </TouchableOpacity>
            </View>

            {/* Target medication */}
            <View style={mStyles.targetCard}>
              <Ionicons
                name="medkit-outline"
                size={16}
                color={Colors.primary}
              />
              <View style={{ flex: 1 }}>
                <Text style={mStyles.targetLabel}>Checking against</Text>
                <Text style={mStyles.targetName}>{medication.name}</Text>
                <Text style={mStyles.targetDosage}>
                  {getDosageDisplay(medication)}
                </Text>
              </View>
            </View>

            {/* ── Step: idle — capture front ── */}
            {scanStep === "idle" && (
              <View style={mStyles.stateBox}>
                <Ionicons
                  name="scan-outline"
                  size={48}
                  color={Colors.primary}
                />
                <Text style={mStyles.stateTitle}>Scan the Front Label</Text>
                <Text style={mStyles.stateHint}>
                  Point your camera at the front of the medicine packaging
                </Text>
                <TouchableOpacity
                  style={mStyles.captureBtn}
                  onPress={onCaptureFront}
                >
                  <Ionicons name="camera-outline" size={18} color="#fff" />
                  <Text style={mStyles.captureBtnText}>Scan Front</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ── Step: front_done — optionally capture back ── */}
            {scanStep === "front_done" && (
              <View style={mStyles.stateBox}>
                <Ionicons
                  name="checkmark-circle-outline"
                  size={48}
                  color="#27AE60"
                />
                <Text style={mStyles.stateTitle}>Front Captured ✓</Text>
                <Text style={mStyles.stateHint}>
                  Scan the back to also check the expiration date, or skip to
                  process now
                </Text>
                <View style={mStyles.dualBtns}>
                  <TouchableOpacity
                    style={mStyles.skipBtn}
                    onPress={onSkipBack}
                  >
                    <Ionicons
                      name="play-skip-forward-outline"
                      size={16}
                      color={Colors.primary}
                    />
                    <Text style={mStyles.skipBtnText}>Skip Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={mStyles.captureBtn}
                    onPress={onCaptureBack}
                  >
                    <Ionicons name="camera-outline" size={16} color="#fff" />
                    <Text style={mStyles.captureBtnText}>Scan Back</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* ── Step: scanning ── */}
            {scanStep === "scanning" && (
              <View style={mStyles.stateBox}>
                <ActivityIndicator size="large" color={Colors.primary} />
                <Text style={mStyles.stateTitle}>Scanning label…</Text>
                <Text style={mStyles.stateHint}>
                  Analysing the label with AI vision
                </Text>
              </View>
            )}

            {/* ── Step: error ── */}
            {scanStep === "error" && (
              <View style={mStyles.stateBox}>
                <Ionicons
                  name="alert-circle-outline"
                  size={48}
                  color="#E74C3C"
                />
                <Text style={[mStyles.stateTitle, { color: "#E74C3C" }]}>
                  Scan Failed
                </Text>
                <Text style={mStyles.stateHint}>{error}</Text>
              </View>
            )}

            {/* ── Step: done ── */}
            {scanStep === "done" && result && (
              <>
                <View
                  style={[
                    mStyles.resultBanner,
                    {
                      borderColor: matchColor,
                      backgroundColor: matchColor + "12",
                    },
                  ]}
                >
                  <Ionicons name={matchIcon} size={32} color={matchColor} />
                  <View style={{ flex: 1 }}>
                    <Text style={[mStyles.resultTitle, { color: matchColor }]}>
                      {matchTitle}
                    </Text>
                    <Text style={mStyles.resultMessage}>{matchMessage}</Text>
                  </View>
                </View>

                <View style={mStyles.detailsBox}>
                  <Text style={mStyles.detailsLabel}>Scanned from label</Text>

                  {/* Name row */}
                  <View style={mStyles.detailRow}>
                    <Text style={mStyles.detailKey}>Name</Text>
                    <View style={mStyles.detailValueRow}>
                      <Text style={mStyles.detailValue}>
                        {result.scannedName ?? "Not found"}
                      </Text>
                      <Ionicons
                        name={
                          result.nameMatch ? "checkmark-circle" : "close-circle"
                        }
                        size={16}
                        color={result.nameMatch ? "#27AE60" : "#E74C3C"}
                      />
                    </View>
                  </View>

                  <View style={mStyles.detailDivider} />

                  {/* Dosage row */}
                  <View style={mStyles.detailRow}>
                    <Text style={mStyles.detailKey}>Dosage</Text>
                    <View style={mStyles.detailValueRow}>
                      <Text style={mStyles.detailValue}>
                        {result.scannedDosage ?? "Not found"}
                      </Text>
                      <Ionicons
                        name={
                          result.dosageMatch
                            ? "checkmark-circle"
                            : "close-circle"
                        }
                        size={16}
                        color={result.dosageMatch ? "#27AE60" : "#E74C3C"}
                      />
                    </View>
                  </View>

                  {/* Expiry row (only if found) */}
                  {result.scannedExpiration && (
                    <>
                      <View style={mStyles.detailDivider} />
                      <View style={mStyles.detailRow}>
                        <Text style={mStyles.detailKey}>Expiry</Text>
                        <View style={mStyles.detailValueRow}>
                          <Text
                            style={[
                              mStyles.detailValue,
                              isExpired && { color: "#E74C3C" },
                            ]}
                          >
                            {result.scannedExpiration}
                            {isExpired ? " ⚠️" : ""}
                          </Text>
                          <Ionicons
                            name={isExpired ? "warning" : "checkmark-circle"}
                            size={16}
                            color={isExpired ? "#E74C3C" : "#27AE60"}
                          />
                        </View>
                      </View>
                    </>
                  )}

                  {result.confidence === "low" && (
                    <Text style={mStyles.lowConfidence}>
                      ⚠️ Label was hard to read — result may be inaccurate. Try
                      better lighting.
                    </Text>
                  )}
                </View>
              </>
            )}

            {/* Actions */}
            {(scanStep === "done" || scanStep === "error") && (
              <View style={mStyles.actions}>
                <TouchableOpacity
                  style={mStyles.scanAgainBtn}
                  onPress={onScanAgain}
                >
                  <Ionicons
                    name="camera-outline"
                    size={18}
                    color={Colors.primary}
                  />
                  <Text style={mStyles.scanAgainText}>Scan Again</Text>
                </TouchableOpacity>
                <TouchableOpacity style={mStyles.doneBtn} onPress={onClose}>
                  <Text style={mStyles.doneBtnText}>Done</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export const MedicationsTab: React.FC<MedicationsTabProps> = ({
  medications,
  searchQuery,
  reminders,
  onAddReminder,
  onEditMedication,
  onDeleteMedication,
  isCaregiver = false,
  canEdit = true,
  canDelete = true,
  canManageReminders = true,
}) => {
  const [verifyMedication, setVerifyMedication] = useState<Medication | null>(
    null,
  );
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>("idle");
  const [scanStep, setScanStep] = useState<ScanStep>("idle");
  const [frontPhoto, setFrontPhoto] = useState<CapturedPhoto | null>(null);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [showExpiredModal, setShowExpiredModal] = useState(false);

  const filteredMedications = medications.filter((med) => {
    const dosageDisplay = getDosageDisplay(med);
    return (
      med.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      dosageDisplay.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  // ── Open verify modal ──────────────────────────────────────────────────

  const handleVerify = (medication: Medication) => {
    setVerifyMedication(medication);
    setVerifyResult(null);
    setVerifyError(null);
    setScanStep("idle");
    setFrontPhoto(null);
    setShowExpiredModal(false);
    setModalVisible(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  // ── Step 1: Capture front ──────────────────────────────────────────────

  const handleCaptureFront = async () => {
    try {
      const photo = await openCamera();
      if (!photo) return;
      setFrontPhoto(photo);
      setScanStep("front_done");
    } catch (err: any) {
      setVerifyError(err.message ?? "Something went wrong.");
      setScanStep("error");
    }
  };

  // ── Step 2a: Capture back then process ────────────────────────────────

  const handleCaptureBack = async () => {
    if (!frontPhoto || !verifyMedication) return;
    try {
      const back = await openCamera();
      if (!back) return;
      await processImages(frontPhoto, verifyMedication, back);
    } catch (err: any) {
      setVerifyError(err.message ?? "Something went wrong.");
      setScanStep("error");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  // ── Step 2b: Skip back ─────────────────────────────────────────────────

  const handleSkipBack = async () => {
    if (!frontPhoto || !verifyMedication) return;
    await processImages(frontPhoto, verifyMedication);
  };

  // ── Core: send to GPT-4o ───────────────────────────────────────────────

  const processImages = async (
    front: CapturedPhoto,
    medication: Medication,
    back?: CapturedPhoto,
  ) => {
    try {
      setScanStep("scanning");

      const scanned = await scanLabelForVerification(front, back);

      if (!scanned.isMedicine) {
        setVerifyError(
          "No medicine label detected. Make sure the label is clearly visible and try again.",
        );
        setScanStep("error");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      }

      const expired = isMedicationExpired(scanned.expirationDate);

      const result: VerifyResult = {
        scannedName: scanned.name,
        scannedDosage: scanned.dosageMg,
        scannedExpiration: scanned.expirationDate,
        nameMatch: namesMatch(medication.name, scanned.name),
        dosageMatch: dosagesMatch(medication, scanned.dosageMg),
        isExpired: expired,
        confidence: scanned.confidence,
        rawText: scanned.rawText,
      };

      setVerifyResult(result);
      setScanStep("done");

      if (expired) {
        // Show the dedicated expired modal on top of the result sheet
        setShowExpiredModal(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } else if (result.nameMatch && result.dosageMatch) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch (err: any) {
      setVerifyError(err.message ?? "Something went wrong.");
      setScanStep("error");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  // ── Scan again: reset to step 1 inside the same modal ─────────────────

  const handleScanAgain = () => {
    setVerifyResult(null);
    setVerifyError(null);
    setFrontPhoto(null);
    setShowExpiredModal(false);
    setScanStep("idle");
  };

  const handleCloseModal = () => {
    setModalVisible(false);
    setVerifyStatus("idle");
    setScanStep("idle");
    setFrontPhoto(null);
    setVerifyResult(null);
    setVerifyError(null);
    setShowExpiredModal(false);
  };

  // ── Render ─────────────────────────────────────────────────────────────

  if (filteredMedications.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="medical" size={60} color={Colors.textTertiary} />
        <Text style={styles.emptyStateText}>No medications found</Text>
      </View>
    );
  }

  return (
    <>
      <VerifyModal
        visible={modalVisible}
        medication={verifyMedication}
        verifyStatus={verifyStatus}
        scanStep={scanStep}
        frontPhoto={frontPhoto}
        result={verifyResult}
        error={verifyError}
        showExpiredModal={showExpiredModal}
        onClose={handleCloseModal}
        onCaptureFront={handleCaptureFront}
        onCaptureBack={handleCaptureBack}
        onSkipBack={handleSkipBack}
        onScanAgain={handleScanAgain}
        onCloseExpired={() => setShowExpiredModal(false)}
      />

      <View style={styles.medicationsList}>
        {filteredMedications.map((medication) => (
          <View key={medication.id} style={styles.medicationCard}>
            {/* Name */}
            <Text style={styles.medicationName}>{medication.name}</Text>

            {/* Dosage */}
            <Text style={styles.medicationDosage}>
              {getDosageDisplay(medication)}
            </Text>

            {/* Generic name */}
            {medication.generic_name &&
              medication.generic_name !== medication.name && (
                <Text style={styles.genericName}>
                  {medication.generic_name}
                </Text>
              )}

            {/* Details */}
            <View style={styles.medicationDetails}>
              <View style={styles.detailItem}>
                <Ionicons name="cube" size={16} color={Colors.textSecondary} />
                <Text style={styles.detailText}>
                  Quantity: {medication.quantity}
                </Text>
              </View>

              {reminders.filter((r) => r.medicationId === medication.id)
                .length > 0 && (
                <View style={styles.reminderBadge}>
                  <Ionicons name="alarm" size={14} color={Colors.primary} />
                  <Text style={styles.reminderBadgeText}>
                    {
                      reminders.filter((r) => r.medicationId === medication.id)
                        .length
                    }{" "}
                    reminder(s)
                  </Text>
                </View>
              )}
            </View>

            {/* ── Footer row: Add Reminder (left) + scan/edit/delete (right) ── */}
            <View style={styles.cardFooter}>
              {/* Add Reminder */}
              <TouchableOpacity
                style={[
                  styles.quickAddReminder,
                  isCaregiver &&
                    !canManageReminders &&
                    styles.disabledReminderButton,
                ]}
                onPress={onAddReminder}
                disabled={isCaregiver && !canManageReminders}
              >
                <Ionicons
                  name="add-circle-outline"
                  size={18}
                  color={
                    isCaregiver && !canManageReminders
                      ? Colors.textTertiary
                      : Colors.primary
                  }
                />
                <Text
                  style={[
                    styles.quickAddReminderText,
                    isCaregiver &&
                      !canManageReminders &&
                      styles.disabledReminderText,
                  ]}
                >
                  Add Reminder
                </Text>
              </TouchableOpacity>

              {/* Action icons: scan · edit · delete */}
              <View style={styles.actionIcons}>
                {/* Scan to Verify */}
                <TouchableOpacity
                  onPress={() => handleVerify(medication)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons
                    name="scan-outline"
                    size={20}
                    color={Colors.primary}
                  />
                </TouchableOpacity>

                {/* Edit */}
                <TouchableOpacity
                  onPress={() => onEditMedication(medication)}
                  disabled={isCaregiver && !canEdit}
                  style={
                    isCaregiver && !canEdit ? styles.disabledButton : undefined
                  }
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons
                    name="pencil"
                    size={20}
                    color={
                      isCaregiver && !canEdit
                        ? Colors.textTertiary
                        : Colors.primary
                    }
                  />
                </TouchableOpacity>

                {/* Delete */}
                <TouchableOpacity
                  onPress={() => onDeleteMedication(medication.id)}
                  disabled={isCaregiver && !canDelete}
                  style={
                    isCaregiver && !canDelete
                      ? styles.disabledButton
                      : undefined
                  }
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons
                    name="trash"
                    size={20}
                    color={
                      isCaregiver && !canDelete
                        ? Colors.textTertiary
                        : Colors.error
                    }
                  />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ))}
      </View>
    </>
  );
};

// ─── Card styles ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  medicationsList: { paddingBottom: 100 },
  medicationCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 1,
  },
  medicationName: {
    fontSize: 14,
    fontWeight: "bold",
    color: Colors.text,
    marginBottom: 4,
  },
  medicationDosage: {
    fontSize: 12,
    color: Colors.primary,
    fontWeight: "500",
    marginBottom: 4,
  },
  genericName: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 8,
    fontStyle: "italic",
  },
  medicationDetails: { gap: 8, marginBottom: 12 },
  detailItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  detailText: { fontSize: 12, color: Colors.textSecondary, flex: 1 },
  reminderBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.primary + "10",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: "flex-start",
    gap: 4,
    marginTop: 4,
  },
  reminderBadgeText: { fontSize: 12, color: Colors.primary, fontWeight: "500" },

  // Footer: Add Reminder (left) + icons (right) on one line
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 10,
  },
  quickAddReminder: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  quickAddReminderText: {
    fontSize: 12,
    color: Colors.primary,
    fontWeight: "500",
  },
  actionIcons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },

  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
  },
  emptyStateText: { fontSize: 16, color: Colors.textTertiary, marginTop: 16 },
  disabledButton: { opacity: 0.5 },
  disabledReminderButton: { opacity: 0.5 },
  disabledReminderText: { color: Colors.textTertiary },
});

// ─── Modal styles ─────────────────────────────────────────────────────────────

const mStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.50)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingBottom: 40,
    paddingTop: 14,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 12,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: "#DDD",
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  headerTitle: { fontSize: 18, fontWeight: "700", color: "#1A1A2E" },

  targetCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: Colors.primary + "0D",
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
  },
  targetLabel: {
    fontSize: 11,
    color: Colors.primary,
    fontWeight: "600",
    marginBottom: 2,
  },
  targetName: { fontSize: 15, fontWeight: "700", color: "#1A1A2E" },
  targetDosage: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },

  stateBox: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 20,
  },
  stateTitle: { fontSize: 16, fontWeight: "600", color: "#1A1A2E" },
  stateHint: {
    fontSize: 13,
    color: "#999",
    textAlign: "center",
    lineHeight: 19,
    paddingHorizontal: 8,
  },

  // Step buttons
  captureBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 28,
    marginTop: 4,
  },
  captureBtnText: { fontSize: 14, fontWeight: "700", color: "#fff" },
  dualBtns: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
    width: "100%",
  },
  skipBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 12,
  },
  skipBtnText: { fontSize: 14, fontWeight: "600", color: Colors.primary },

  resultBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    borderWidth: 1.5,
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
  },
  resultTitle: { fontSize: 15, fontWeight: "700", marginBottom: 4 },
  resultMessage: { fontSize: 13, color: "#444", lineHeight: 18 },

  detailsBox: {
    backgroundColor: "#F7F8FC",
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
  },
  detailsLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#999",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  detailKey: { fontSize: 13, color: "#888" },
  detailValueRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  detailValue: { fontSize: 13, fontWeight: "600", color: "#1A1A2E" },
  detailDivider: { height: 1, backgroundColor: "#EBEBF0", marginVertical: 8 },
  lowConfidence: {
    fontSize: 12,
    color: "#856404",
    backgroundColor: "#FFF3CD",
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
    lineHeight: 17,
  },

  actions: { flexDirection: "row", gap: 10 },
  scanAgainBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 13,
  },
  scanAgainText: { fontSize: 14, fontWeight: "600", color: Colors.primary },
  doneBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 13,
  },
  doneBtnText: { fontSize: 14, fontWeight: "700", color: "#fff" },
});

// ─── Expired modal styles ─────────────────────────────────────────────────────

const eStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  card: {
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
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#FDECEA",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: "#C0392B",
    marginBottom: 12,
    textAlign: "center",
  },
  body: {
    fontSize: 15,
    color: "#333",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 10,
  },
  advice: {
    fontSize: 13,
    color: "#888",
    textAlign: "center",
    lineHeight: 19,
    marginBottom: 24,
  },
  btn: {
    backgroundColor: "#E74C3C",
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 40,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});

export default MedicationsTab;
