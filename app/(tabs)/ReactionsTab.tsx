// app/(tabs)/ReactionsTab.tsx
import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Colors from "../../constants/colors";

interface ReactionsTabProps {
  aiAnalysis: any;
  loadingReactions: boolean;
  reactionsError?: string | null;
  symptomLogs: any[];
  medications: any[];
  todaysMedications?: any[];
  onLogSymptom: () => void;
  onDeleteSymptomLog: (id: string) => void;
  onRefresh: () => void;
}

// Helper functions
const warningColor = (severity: "info" | "caution" | "danger") => {
  if (severity === "danger") return Colors.error;
  if (severity === "caution") return Colors.warning;
  return Colors.primary;
};

const interactionColor = (severity: "mild" | "moderate" | "severe") => {
  if (severity === "severe") return Colors.error;
  if (severity === "moderate") return Colors.warning;
  return Colors.success;
};

const severityLabels = [
  "",
  "Mild",
  "Moderate",
  "Noticeable",
  "Severe",
  "Extreme",
];
const severityColors = [
  "",
  Colors.success,
  Colors.success,
  Colors.warning,
  Colors.error,
  Colors.error,
];

const formatLogDate = (timestamp: any) => {
  if (!timestamp) return "";
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

// ✅ Helper function to deduplicate interactions
const deduplicateInteractions = (interactions: any[]) => {
  if (!interactions || !Array.isArray(interactions)) return [];

  const seen = new Set<string>();
  const deduped: any[] = [];

  for (const interaction of interactions) {
    // Create a unique key based on the two drug names (sorted alphabetically)
    const drugA = interaction.drugA || "";
    const drugB = interaction.drugB || "";
    const key = [drugA, drugB].sort().join("|");

    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(interaction);
    }
  }

  return deduped;
};

export const ReactionsTab: React.FC<ReactionsTabProps> = ({
  aiAnalysis,
  loadingReactions,
  reactionsError,
  symptomLogs,
  medications,
  todaysMedications = [],
  onLogSymptom,
  onDeleteSymptomLog,
  onRefresh,
}) => {
  console.log("ReactionsTab Debug:", {
    hasAiAnalysis: !!aiAnalysis,
    aiAnalysisKeys: aiAnalysis ? Object.keys(aiAnalysis) : [],
    loadingReactions,
    reactionsError,
    todaysMedicationsCount: todaysMedications.length,
  });
  const [selectedModal, setSelectedModal] = useState<{
    type:
      | "interactions"
      | "sideEffects"
      | "community"
      | "profileWarnings"
      | "sideEffectDetail";
    data?: any;
    title: string;
  } | null>(null);

  // ✅ Memoize deduplicated interactions
  const dedupedInteractions = useMemo(() => {
    return deduplicateInteractions(aiAnalysis?.interactions);
  }, [aiAnalysis?.interactions]);

  // Use deduped count for display
  const interactionCount = dedupedInteractions.length;
  const sideEffectCount = aiAnalysis?.sideEffects?.length || 0;
  const communityCount = aiAnalysis?.communityReports?.length || 0;
  const warningCount = aiAnalysis?.profileWarnings?.length || 0;
  const hasIssues = interactionCount > 0 || warningCount > 0;

  if (loadingReactions) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Analyzing your medications...</Text>
        <Text style={[styles.loadingText, { fontSize: 13, marginTop: 4 }]}>
          Checking interactions and side effects
        </Text>
      </View>
    );
  }

  if (reactionsError) {
    return (
      <View style={styles.emptyCard}>
        <Ionicons name="warning-outline" size={32} color={Colors.error} />
        <Text style={[styles.emptyText, { color: Colors.error }]}>
          {reactionsError}
        </Text>
        <TouchableOpacity style={styles.retryButton} onPress={onRefresh}>
          <Text style={styles.retryButtonText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!aiAnalysis) {
    return (
      <View style={styles.emptyCard}>
        <Ionicons
          name="medical-outline"
          size={48}
          color={Colors.textTertiary}
        />
        <Text style={styles.emptyText}>Add medications to see AI analysis</Text>
        <Text style={styles.emptySubtext}>
          We'll analyze interactions, side effects, and provide insights
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Today's Medications Section */}
      {todaysMedications.length > 0 && (
        <View style={styles.todayMedsCard}>
          <View style={styles.todayMedsHeader}>
            <Ionicons name="today" size={20} color={Colors.primary} />
            <Text style={styles.todayMedsTitle}>Today's Medications</Text>
          </View>
          <View style={styles.todayMedsList}>
            {todaysMedications.map((med) => (
              <View key={med.id} style={styles.todayMedItem}>
                <Ionicons name="medical" size={14} color={Colors.primary} />
                <Text style={styles.todayMedName}>{med.name}</Text>
                <Text style={styles.todayMedDosage}>{med.dosage}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.todayMedsNote}>
            AI analysis is based on these {todaysMedications.length} medication
            {todaysMedications.length !== 1 ? "s" : ""} taken today
          </Text>
        </View>
      )}

      {/* Header Summary Card */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryHeader}>
          <Ionicons name="sparkles" size={24} color={Colors.primary} />
          <Text style={styles.summaryTitle}>AI Insights</Text>
          <TouchableOpacity onPress={onRefresh} style={styles.refreshButton}>
            <Ionicons name="refresh" size={20} color={Colors.primary} />
          </TouchableOpacity>
        </View>

        <Text style={styles.summaryText}>{aiAnalysis.summary}</Text>

        {/* Quick Stats */}
        <View style={styles.statsRow}>
          {interactionCount > 0 && (
            <View style={styles.statBadge}>
              <Ionicons name="git-compare" size={14} color={Colors.error} />
              <Text style={[styles.statText, { color: Colors.error }]}>
                {interactionCount} Interaction
                {interactionCount !== 1 ? "s" : ""}
              </Text>
            </View>
          )}
          {warningCount > 0 && (
            <View style={styles.statBadge}>
              <Ionicons name="alert-circle" size={14} color={Colors.warning} />
              <Text style={[styles.statText, { color: Colors.warning }]}>
                {warningCount} Warning{warningCount !== 1 ? "s" : ""}
              </Text>
            </View>
          )}
          {sideEffectCount > 0 && (
            <View style={styles.statBadge}>
              <Ionicons name="warning" size={14} color={Colors.textTertiary} />
              <Text style={styles.statText}>
                {sideEffectCount} Medication{sideEffectCount !== 1 ? "s" : ""}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Critical Alerts Section - Only show if there are issues */}
      {hasIssues && (
        <View style={styles.alertSection}>
          <Text style={styles.alertSectionTitle}>⚠️ Critical Alerts</Text>

          {warningCount > 0 && (
            <TouchableOpacity
              style={styles.alertCard}
              onPress={() =>
                setSelectedModal({
                  type: "profileWarnings",
                  title: "Profile Warnings",
                  data: aiAnalysis.profileWarnings,
                })
              }
            >
              <View style={styles.alertIcon}>
                <Ionicons
                  name="alert-circle"
                  size={24}
                  color={Colors.warning}
                />
              </View>
              <View style={styles.alertContent}>
                <Text style={styles.alertTitle}>Health Profile Alerts</Text>
                <Text style={styles.alertMessage}>
                  {warningCount} condition-specific warning
                  {warningCount !== 1 ? "s" : ""} detected
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={20}
                color={Colors.textTertiary}
              />
            </TouchableOpacity>
          )}

          {interactionCount > 0 && (
            <TouchableOpacity
              style={styles.alertCard}
              onPress={() =>
                setSelectedModal({
                  type: "interactions",
                  title: "Drug Interactions",
                  data: dedupedInteractions, // ✅ Use deduped interactions
                })
              }
            >
              <View style={styles.alertIcon}>
                <Ionicons name="git-compare" size={24} color={Colors.error} />
              </View>
              <View style={styles.alertContent}>
                <Text style={styles.alertTitle}>Drug Interactions</Text>
                <Text style={styles.alertMessage}>
                  {interactionCount} potential interaction
                  {interactionCount !== 1 ? "s" : ""} found
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={20}
                color={Colors.textTertiary}
              />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Rest of your component remains the same... */}
      {/* Side Effects Summary */}
      {sideEffectCount > 0 && (
        <TouchableOpacity
          style={styles.infoCard}
          onPress={() =>
            setSelectedModal({
              type: "sideEffects",
              title: "Side Effects Details",
              data: aiAnalysis.sideEffects,
            })
          }
        >
          <View style={styles.infoCardHeader}>
            <Ionicons name="warning" size={22} color={Colors.warning} />
            <Text style={styles.infoCardTitle}>Side Effects</Text>
          </View>
          <Text style={styles.infoCardSummary}>
            View common and serious side effects for your {sideEffectCount}{" "}
            medication{sideEffectCount !== 1 ? "s" : ""}
          </Text>
          <View style={styles.seeMoreButton}>
            <Text style={styles.seeMoreText}>See details →</Text>
          </View>
        </TouchableOpacity>
      )}

      {/* Community Reports Summary
      {communityCount > 0 && (
        <TouchableOpacity
          style={styles.infoCard}
          onPress={() =>
            setSelectedModal({
              type: "community",
              title: "Community Reports",
              data: aiAnalysis.communityReports,
            })
          }
        >
          <View style={styles.infoCardHeader}>
            <Ionicons name="people" size={22} color={Colors.primary} />
            <Text style={styles.infoCardTitle}>Community Reports</Text>
          </View>
          <Text style={styles.infoCardSummary}>
            {communityCount} report{communityCount !== 1 ? "s" : ""} from users
            with similar conditions
          </Text>
          <View style={styles.seeMoreButton}>
            <Text style={styles.seeMoreText}>Learn more →</Text>
          </View>
        </TouchableOpacity>
      )}


      <View style={styles.symptomSection}>
        <View style={styles.symptomHeader}>
          <View style={styles.symptomTitleRow}>
            <Ionicons name="clipboard" size={22} color={Colors.primary} />
            <Text style={styles.symptomTitle}>My Symptom Log</Text>
          </View>
          <TouchableOpacity style={styles.logButton} onPress={onLogSymptom}>
            <Ionicons name="add-circle" size={24} color={Colors.primary} />
            <Text style={styles.logButtonText}>Log</Text>
          </TouchableOpacity>
        </View>

        {symptomLogs.length > 0 ? (
          symptomLogs.slice(0, 3).map((log) => (
            <View key={log.id} style={styles.symptomCard}>
              <View style={styles.symptomCardHeader}>
                <Text style={styles.symptomName}>{log.symptom}</Text>
                <View
                  style={[
                    styles.severityBadge,
                    {
                      backgroundColor:
                        (severityColors[log.severity] || Colors.textTertiary) +
                        "20",
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.severityText,
                      {
                        color:
                          severityColors[log.severity] || Colors.textTertiary,
                      },
                    ]}
                  >
                    {severityLabels[log.severity] || "Unknown"}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => onDeleteSymptomLog(log.id)}
                >
                  <Ionicons
                    name="trash-outline"
                    size={16}
                    color={Colors.error}
                  />
                </TouchableOpacity>
              </View>
              {log.note && <Text style={styles.symptomNote}>{log.note}</Text>}
              {log.medication_ids?.length > 0 && (
                <View style={styles.logMeds}>
                  <Ionicons
                    name="medical"
                    size={12}
                    color={Colors.textTertiary}
                  />
                  <Text style={styles.logMedsText}>
                    {log.medication_ids
                      .map(
                        (id: string) =>
                          medications.find((m) => m.id === id)?.name || id,
                      )
                      .join(", ")}
                  </Text>
                </View>
              )}
              <Text style={styles.symptomDate}>
                {formatLogDate(log.logged_at)}
              </Text>
            </View>
          ))
        ) : (
          <TouchableOpacity style={styles.emptyLogCard} onPress={onLogSymptom}>
            <Ionicons
              name="clipboard-outline"
              size={32}
              color={Colors.textTertiary}
            />
            <Text style={styles.emptyLogText}>No symptoms logged yet</Text>
            <Text style={styles.emptyLogSubtext}>
              Tap to log your first symptom
            </Text>
          </TouchableOpacity>
        )}

        {symptomLogs.length > 3 && (
          <Text style={styles.moreLogsText}>
            +{symptomLogs.length - 3} more symptom
            {symptomLogs.length - 3 !== 1 ? "s" : ""}
          </Text>
        )}
      </View> */}

      {/* Detail Modal - Update the interactions display */}
      <Modal
        animationType="slide"
        transparent={false}
        visible={selectedModal !== null}
        onRequestClose={() => setSelectedModal(null)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setSelectedModal(null)}>
              <Ionicons name="arrow-back" size={24} color={Colors.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>{selectedModal?.title}</Text>
            <View style={{ width: 24 }} />
          </View>

          <ScrollView
            style={styles.modalContent}
            showsVerticalScrollIndicator={false}
          >
            {selectedModal?.type === "interactions" && (
              <View>
                <Text style={styles.modalSubtitle}>
                  Drug interactions can affect how your medications work
                </Text>
                {/* ✅ Display deduplicated interactions */}
                {selectedModal.data.map((interaction: any, index: number) => (
                  <View
                    key={index}
                    style={[
                      styles.detailCard,
                      {
                        borderLeftColor: interactionColor(interaction.severity),
                      },
                    ]}
                  >
                    <View style={styles.detailCardHeader}>
                      <Text style={styles.detailCardTitle}>
                        {interaction.drugA} ↔ {interaction.drugB}
                      </Text>
                      <View
                        style={[
                          styles.severityBadge,
                          {
                            backgroundColor:
                              interactionColor(interaction.severity) + "20",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.severityText,
                            { color: interactionColor(interaction.severity) },
                          ]}
                        >
                          {interaction.severity}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.detailReason}>
                      {interaction.severityReason}
                    </Text>
                    <Text style={styles.detailDescription}>
                      {interaction.description}
                    </Text>
                    {interaction.recommendation && (
                      <View style={styles.recommendationBox}>
                        <Ionicons
                          name="bulb-outline"
                          size={16}
                          color={Colors.warning}
                        />
                        <Text style={styles.recommendationText}>
                          {interaction.recommendation}
                        </Text>
                      </View>
                    )}
                  </View>
                ))}
              </View>
            )}

            {/* Rest of your modal content remains the same */}
            {selectedModal?.type === "sideEffects" && (
              <View>
                <Text style={styles.modalSubtitle}>
                  Common and serious side effects reported for your medications
                </Text>
                {selectedModal.data.map((item: any, index: number) => (
                  <TouchableOpacity
                    key={index}
                    style={styles.detailCard}
                    onPress={() => {
                      setSelectedModal({
                        type: "sideEffectDetail",
                        title: item.medicationName,
                        data: item,
                      });
                    }}
                  >
                    <View style={styles.detailCardHeader}>
                      <Text style={styles.detailCardTitle}>
                        {item.medicationName}
                      </Text>
                      <Ionicons
                        name="chevron-forward"
                        size={20}
                        color={Colors.textTertiary}
                      />
                    </View>
                    <Text style={styles.detailDescription} numberOfLines={2}>
                      {item.summary}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {selectedModal?.type === "sideEffectDetail" && (
              <View>
                <Text style={styles.modalSubtitle}>
                  Detailed side effects for {selectedModal.data.medicationName}
                </Text>

                {selectedModal.data.profileWarnings?.length > 0 && (
                  <View style={styles.warningSection}>
                    <Text style={styles.warningSectionTitle}>
                      ⚠️ Personal Alerts
                    </Text>
                    {selectedModal.data.profileWarnings.map(
                      (w: any, i: number) => (
                        <View key={i} style={styles.warningDetailCard}>
                          <Text style={styles.warningDetailTitle}>
                            {w.type}
                          </Text>
                          <Text style={styles.warningDetailText}>
                            {w.warning}
                          </Text>
                        </View>
                      ),
                    )}
                  </View>
                )}

                {selectedModal.data.common?.length > 0 && (
                  <View style={styles.sideEffectSection}>
                    <Text style={styles.sideEffectSectionTitle}>
                      Common Side Effects
                    </Text>
                    {selectedModal.data.common.map((se: string, i: number) => (
                      <View key={i} style={styles.bulletItem}>
                        <Text style={styles.bullet}>•</Text>
                        <Text style={styles.bulletText}>{se}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {selectedModal.data.serious?.length > 0 && (
                  <View style={styles.sideEffectSection}>
                    <Text
                      style={[
                        styles.sideEffectSectionTitle,
                        { color: Colors.error },
                      ]}
                    >
                      Serious / Rare Side Effects
                    </Text>
                    {selectedModal.data.serious.map((se: string, i: number) => (
                      <View key={i} style={styles.bulletItem}>
                        <Text style={[styles.bullet, { color: Colors.error }]}>
                          •
                        </Text>
                        <Text style={styles.bulletText}>{se}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}

            {selectedModal?.type === "profileWarnings" && (
              <View>
                <Text style={styles.modalSubtitle}>
                  Health profile specific warnings for your medications
                </Text>
                {selectedModal.data.map((warning: any, index: number) => (
                  <View
                    key={index}
                    style={[
                      styles.detailCard,
                      { borderLeftColor: warningColor(warning.severity) },
                    ]}
                  >
                    <View style={styles.detailCardHeader}>
                      <Text style={styles.detailCardTitle}>
                        {warning.type.charAt(0).toUpperCase() +
                          warning.type.slice(1)}{" "}
                        Warning
                      </Text>
                      <View
                        style={[
                          styles.severityBadge,
                          {
                            backgroundColor:
                              warningColor(warning.severity) + "20",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.severityText,
                            { color: warningColor(warning.severity) },
                          ]}
                        >
                          {warning.severity}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.detailDescription}>
                      {warning.warning}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {selectedModal?.type === "community" && (
              <View>
                <Text style={styles.modalSubtitle}>
                  Anonymized reports from users with similar health profiles
                </Text>
                <View style={styles.disclaimerBox}>
                  <Ionicons
                    name="information-circle"
                    size={16}
                    color={Colors.primary}
                  />
                  <Text style={styles.disclaimerText}>
                    For reference only. Not medical advice. Always consult your
                    doctor.
                  </Text>
                </View>
                {selectedModal.data.map((report: any, index: number) => (
                  <View key={index} style={styles.communityCard}>
                    <View style={styles.communityHeader}>
                      <Text style={styles.communitySymptom}>
                        {report.symptom}
                      </Text>
                      <View style={styles.communityStats}>
                        <View style={styles.communityStat}>
                          <Ionicons
                            name="people"
                            size={12}
                            color={Colors.textTertiary}
                          />
                          <Text style={styles.communityStatText}>
                            {report.reportCount} reports
                          </Text>
                        </View>
                        <View style={styles.communityStat}>
                          <Ionicons
                            name="trending-up"
                            size={12}
                            color={Colors.warning}
                          />
                          <Text style={styles.communityStatText}>
                            avg {report.avgSeverity.toFixed(1)}/5
                          </Text>
                        </View>
                      </View>
                    </View>
                    {report.note && (
                      <Text style={styles.communityNote}>"{report.note}"</Text>
                    )}
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingBottom: 100,
  },
  loadingContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 13,
    color: Colors.textSecondary,
  },
  emptyCard: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
    paddingHorizontal: 20,
  },
  emptyText: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 16,
    textAlign: "center",
  },
  emptySubtext: {
    fontSize: 13,
    color: Colors.textTertiary,
    marginTop: 8,
    textAlign: "center",
  },
  retryButton: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    marginTop: 20,
  },
  retryButtonText: {
    color: Colors.surface,
    fontSize: 13,
    fontWeight: "600",
  },
  // Today's Medications Section
  todayMedsCard: {
    backgroundColor: Colors.primary + "08",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.primary + "20",
  },
  todayMedsHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  todayMedsTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.text,
  },
  todayMedsList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  todayMedItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    gap: 6,
  },
  todayMedName: {
    fontSize: 10,
    fontWeight: "500",
    color: Colors.text,
  },
  todayMedDosage: {
    fontSize: 10,
    color: Colors.textSecondary,
  },
  todayMedsNote: {
    fontSize: 10,
    color: Colors.textTertiary,
    fontStyle: "italic",
  },
  summaryCard: {
    backgroundColor: Colors.primary + "08",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  summaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  summaryTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.text,
    marginLeft: 8,
    flex: 1,
  },
  refreshButton: {
    padding: 4,
  },
  summaryText: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: 12,
  },
  statsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  statBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 16,
    gap: 4,
  },
  statText: {
    fontSize: 10,
    fontWeight: "500",
    color: Colors.textSecondary,
  },
  alertSection: {
    marginBottom: 16,
  },
  alertSectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.error,
    marginBottom: 8,
  },
  alertCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.error + "08",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.error + "20",
  },
  alertIcon: {
    marginRight: 12,
  },
  alertContent: {
    flex: 1,
  },
  alertTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.text,
    marginBottom: 2,
  },
  alertMessage: {
    fontSize: 10,
    color: Colors.textSecondary,
  },
  infoCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  infoCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    gap: 8,
  },
  infoCardTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.text,
  },
  infoCardSummary: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginBottom: 12,
  },
  seeMoreButton: {
    alignSelf: "flex-start",
  },
  seeMoreText: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: "500",
  },
  symptomSection: {
    marginTop: 8,
    marginBottom: 20,
  },
  symptomHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  symptomTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  symptomTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.text,
  },
  logButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  logButtonText: {
    fontSize: 14,
    color: Colors.primary,
    fontWeight: "600",
  },
  symptomCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  symptomCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  symptomName: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.text,
    flex: 1,
  },
  severityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  severityText: {
    fontSize: 11,
    fontWeight: "600",
  },
  deleteButton: {
    padding: 4,
  },
  symptomNote: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  logMeds: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 4,
  },
  logMedsText: {
    fontSize: 12,
    color: Colors.textTertiary,
    flex: 1,
  },
  symptomDate: {
    fontSize: 11,
    color: Colors.textTertiary,
  },
  emptyLogCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 24,
    alignItems: "center",
    gap: 8,
  },
  emptyLogText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  emptyLogSubtext: {
    fontSize: 12,
    color: Colors.textTertiary,
  },
  moreLogsText: {
    fontSize: 12,
    color: Colors.textTertiary,
    textAlign: "center",
    marginTop: 8,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: Colors.text,
  },
  modalContent: {
    flex: 1,
    padding: 16,
  },
  modalSubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 16,
    lineHeight: 20,
  },
  detailCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 3,
  },
  detailCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  detailCardTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.text,
    flex: 1,
  },
  detailReason: {
    fontSize: 13,
    fontWeight: "500",
    color: Colors.warning,
    marginBottom: 6,
  },
  detailDescription: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  recommendationBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: Colors.warning + "10",
    padding: 10,
    borderRadius: 8,
    marginTop: 10,
    gap: 8,
  },
  recommendationText: {
    flex: 1,
    fontSize: 12,
    color: Colors.warning,
    lineHeight: 16,
  },
  warningSection: {
    marginBottom: 20,
  },
  warningSectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.warning,
    marginBottom: 8,
  },
  warningDetailCard: {
    backgroundColor: Colors.warning + "08",
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderLeftWidth: 2,
    borderLeftColor: Colors.warning,
  },
  warningDetailTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.text,
    marginBottom: 4,
  },
  warningDetailText: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  sideEffectSection: {
    marginBottom: 20,
  },
  sideEffectSectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.text,
    marginBottom: 8,
  },
  bulletItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 6,
    paddingLeft: 4,
  },
  bullet: {
    fontSize: 14,
    marginRight: 8,
    color: Colors.textTertiary,
  },
  bulletText: {
    flex: 1,
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  disclaimerBox: {
    flexDirection: "row",
    backgroundColor: Colors.primary + "08",
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
    gap: 8,
  },
  disclaimerText: {
    flex: 1,
    fontSize: 12,
    color: Colors.primary,
    lineHeight: 16,
  },
  communityCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  communityHeader: {
    marginBottom: 8,
  },
  communitySymptom: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.text,
    marginBottom: 6,
  },
  communityStats: {
    flexDirection: "row",
    gap: 12,
  },
  communityStat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  communityStatText: {
    fontSize: 11,
    color: Colors.textTertiary,
  },
  communityNote: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontStyle: "italic",
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
});
