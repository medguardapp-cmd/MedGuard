// lib/openaiService.ts
// GPT-4o mini - lib/firebase.ts - lib/supabase.ts
//
// HOW THE MAPPING WORKS:
//
//   ph_medicine_mapping bridges PH brand names to DrugBank IDs:
//     ph_brand     = what the patient sees      (e.g. "Biogesic", "Diane 35")
//     generic_name = PH generic name            (e.g. "Paracetamol")
//     ingredients  = DrugBank names of the drug (e.g. ["Acetaminophen"])
//                    - single drug:   ["Acetaminophen"]  (name changed in DrugBank)
//                    - combination:   ["Cyproterone acetate", "Ethinylestradiol"]
//     drug_id      = primary DrugBank ID        (e.g. "DB00316")
//     drug_ids     = all ingredient IDs         (e.g. ["DB04839", "DB00977"])
//
//   For side effects and interactions, ALWAYS use ingredients + drug_ids
//   because that is what matches the drugs table and drug_interactions table.
//
// FLOW PER MESSAGE:
//   1. buildSystemPrompt  -- fetches profile + today's schedule + taken logs (parallel)
//   2. NLP pre-call       -- GPT extracts drug names from the user message   (parallel)
//   3. Mapping lookup     -- ph_medicine_mapping -> get ingredients + drug_ids
//   4. Supabase drugs     -- fetch full clinical data using drug_ids
//   5. Supabase interactions -- check drug_ids against patient's current meds
//   6. GPT main call      -- answers using DB data + patient profile + live schedule

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "./firebase";
import { supabase } from "./supabase";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY!;
const MODEL      = "gpt-4o-mini";

// Preload only tracks uid -- actual prompt is built fresh per message (live schedule)
let cachedUid: string | null = null;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AIResponse {
  type: "text" | "medication" | "health" | "suggestion";
  text: string;
  data?: any;
}

interface MedDoc {
  id: string;
  name: string;
  generic_name?: string;
  dosage?: string;
  drug_id?: string;
  drug_ids?: string[];
  ingredients?: string[];
  is_combination?: boolean;
  active?: boolean;
  quantity?: number;
  refillReminder?: boolean;
  refillThreshold?: number;
  notes?: string | null;
  time?: string;
  taken?: boolean;
}

const FALLBACK_PROMPT = `You are MEADGUARD, a professional clinical medication assistant in a mobile health app.
The patient profile could not be loaded right now. Answer medication questions using general clinical knowledge.
Always recommend consulting a doctor or pharmacist for serious concerns.
Respond ONLY with valid JSON: { "type": "text", "text": "Your response here", "data": null }`;

// ─── Helper: fetch drugs by DrugBank IDs ─────────────────────────────────────

async function fetchDrugsByIds(drugIds: string[]): Promise<any[]> {
  if (!drugIds.length) return [];
  const { data, error } = await supabase
    .from("drugs")
    .select(
      "id, name, state, groups, class, subclass, description, indication, " +
      "pharmacodynamics, mechanism_of_action, toxicity, absorption, " +
      "half_life, metabolism, protein_binding, route_of_elimination",
    )
    .in("id", drugIds);
  if (error) console.warn("⚠️ [Supabase] fetchDrugsByIds:", error.message);
  return data ?? [];
}

// ─── Helper: format one drug entry for GPT context ───────────────────────────

function formatDrug(drug: any, mapping: any | null, label = "DRUG"): string {
  const brands      = mapping?.ph_brand ?? "N/A";
  const genericName = mapping?.generic_name ?? drug?.name ?? "N/A";
  const isCombo     = mapping?.is_combination ?? false;
  const ingredients = mapping?.ingredients?.join(" + ") ?? "N/A";
  return `${label}: ${drug?.name ?? genericName}
  PH brand(s): ${brands}
  PH generic name: ${genericName}
  DrugBank name: ${drug?.name ?? "N/A"}
  Combination: ${isCombo ? `Yes -- ingredients: ${ingredients}` : "No"}
  Drug class: ${drug?.class ?? "N/A"} | Subclass: ${drug?.subclass ?? "N/A"}
  Groups: ${drug?.groups ?? "N/A"}
  Indication: ${drug?.indication ?? "N/A"}
  Pharmacodynamics: ${drug?.pharmacodynamics ?? "N/A"}
  Mechanism of action: ${drug?.mechanism_of_action ?? "N/A"}
  Side effects / Toxicity: ${drug?.toxicity ?? "N/A"}
  Absorption: ${drug?.absorption ?? "N/A"}
  Half-life: ${drug?.half_life ?? "N/A"}
  Metabolism: ${drug?.metabolism ?? "N/A"}
  Description: ${drug?.description ?? "N/A"}`;
}

// ─── 1. NLP drug name extraction ─────────────────────────────────────────────

async function extractDrugNamesFromMessage(message: string): Promise<string[]> {
  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 60,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              `You are a drug name extractor. Extract any medication, drug, vitamin, or supplement names from the user message.\n` +
              `Return ONLY valid JSON: { "drugs": ["name1", "name2"] }\n` +
              `If no drug names found, return: { "drugs": [] }\n` +
              `Rules:\n` +
              `- Include brand names (Biogesic, Medicol, Diane 35) AND generic names (paracetamol, ibuprofen)\n` +
              `- Include vitamins and supplements (Vitamin C, iron, folic acid)\n` +
              `- Do NOT include drug classes (antibiotic, painkiller) -- only specific names\n` +
              `- Keep names exactly as the user wrote them`,
          },
          { role: "user", content: message },
        ],
      }),
    });
    if (!res.ok) return [];
    const json   = await res.json();
    const raw    = json.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);
    const drugs: string[] = parsed.drugs ?? [];
    console.log(`🧠 [NLP] Extracted: ${drugs.length ? drugs.join(", ") : "none"}`);
    return drugs;
  } catch (err: any) {
    console.warn("⚠️ [NLP] Extraction failed:", err.message);
    return [];
  }
}

// ─── 2. Look up a drug by name ────────────────────────────────────────────────

async function lookupDrugByName(drugName: string, patientDrugIds: string[] = []): Promise<string> {
  if (!drugName || drugName.length < 2) return "";
  console.log(`🔵 [Supabase] Looking up: "${drugName}"`);
  try {
    const { data: mappings, error: mapErr } = await supabase
      .from("ph_medicine_mapping")
      .select("id, drug_id, ph_brand, generic_name, drug_ids, ingredients, is_combination")
      .or(`ph_brand.ilike.%${drugName}%,generic_name.ilike.%${drugName}%`)
      .limit(5);
    if (mapErr) console.warn("⚠️ [Supabase] mapping:", mapErr.message);

    let allIngredientIds: string[] = [];
    if (mappings?.length) {
      allIngredientIds = [
        ...new Set(mappings.flatMap((m) => m.drug_ids?.length ? m.drug_ids : m.drug_id ? [m.drug_id] : [])),
      ];
    } else {
      console.log(`🔵 [Supabase] No mapping -- searching drugs table: "${drugName}"`);
      const { data: byName } = await supabase.from("drugs").select("id, name").ilike("name", `%${drugName}%`).limit(3);
      if (!byName?.length) { console.log(`ℹ️ [Supabase] No DB results for: "${drugName}"`); return ""; }
      allIngredientIds = byName.map((d) => d.id);
    }

    const drugs = await fetchDrugsByIds(allIngredientIds);
    let interactionText = "";
    if (patientDrugIds.length && allIngredientIds.length) {
      const pairs = allIngredientIds.flatMap((id) =>
        patientDrugIds.filter((o) => o !== id).map((o) => `and(drug_id.eq.${id},interacts_with.eq.${o})`),
      );
      if (pairs.length) {
        const { data: interactions } = await supabase
          .from("drug_interactions").select("drug_id, interacts_with, description").or(pairs.join(","));
        if (interactions?.length) {
          interactionText =
            "\n  INTERACTIONS WITH PATIENT'S CURRENT MEDS:\n" +
            interactions.map((i) => `    - ${i.drug_id} <-> ${i.interacts_with}: ${i.description ?? "See pharmacist"}`).join("\n");
        }
      }
    }

    if (!mappings?.length && drugs.length) return drugs.map((d) => formatDrug(d, null, "DRUG INFO")).join("\n\n");
    console.log(`✅ [Supabase] Found ${mappings!.length} mapping(s) for "${drugName}"`);
    const seen = new Set<string>();
    return (mappings ?? [])
      .filter((m) => { const key = m.generic_name ?? m.ph_brand; if (seen.has(key)) return false; seen.add(key); return true; })
      .map((m) => { const primaryId = m.drug_ids?.[0] ?? m.drug_id; const drug = drugs.find((d) => d.id === primaryId) ?? drugs[0] ?? null; return formatDrug(drug, m, "DRUG INFO") + interactionText; })
      .join("\n\n");
  } catch (err: any) {
    console.error("❌ [Supabase] lookupDrugByName:", err.message);
    return "";
  }
}

// ─── 3. Fetch live context for NLP-extracted drug names ──────────────────────

async function fetchLiveContext(drugNames: string[], patientDrugIds: string[]): Promise<string> {
  if (!drugNames.length) return "";
  const results = await Promise.all(drugNames.map((n) => lookupDrugByName(n, patientDrugIds)));
  const found = results.filter(Boolean);
  if (found.length) console.log(`✅ [Supabase] Live context ready for: ${drugNames.join(", ")}`);
  return found.join("\n\n");
}

// ─── 4. Fetch Firestore profile ───────────────────────────────────────────────

async function getUserProfile(uid: string) {
  if (!uid) return null;
  try {
    const userSnap = await getDoc(doc(db, "users", uid));
    if (!userSnap.exists()) return null;
    const root        = userSnap.data();
    const userData    = root?.userData    ?? {};
    const medicalData = root?.medicalData ?? {};
    const medsSnap    = await getDocs(collection(db, "users", uid, "medications"));
    const medications: MedDoc[] = medsSnap.docs
      .map((d) => ({ ...(d.data() as MedDoc), id: d.id }))
      .filter((m) => m.active !== false);
    console.log("✅ [Firebase] Profile loaded:", { name: userData.name, conditions: medicalData.conditions, meds: medications.map((m) => m.name) });
    return { userData, medicalData, medications };
  } catch (err: any) {
    console.error("❌ [Firebase] getUserProfile:", err.message);
    return null;
  }
}

function calculateAge(dob: string): string {
  if (!dob) return "unknown";
  try {
    const birth = new Date(dob);
    const today = new Date();
    let age     = today.getFullYear() - birth.getFullYear();
    const m     = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return String(age);
  } catch { return "unknown"; }
}

// ─── 5. Fetch drug context for patient's current medications ─────────────────

async function fetchMedicationContext(meds: MedDoc[]): Promise<string> {
  if (!meds.length) return "";
  const allIngredientIds = [
    ...new Set(meds.flatMap((m) => m.is_combination && m.drug_ids?.length ? m.drug_ids : m.drug_id ? [m.drug_id] : [])),
  ];
  if (!allIngredientIds.length) return "";
  console.log("🔵 [Supabase] Profile drug IDs:", allIngredientIds);
  const [{ data: mappings }, drugs] = await Promise.all([
    supabase.from("ph_medicine_mapping").select("id, drug_id, ph_brand, generic_name, drug_ids, ingredients, is_combination")
      .or(allIngredientIds.map((id) => `drug_id.eq.${id}`).join(",")),
    fetchDrugsByIds(allIngredientIds),
  ]);
  return meds.map((med) => {
    const medDrugIds = med.is_combination && med.drug_ids?.length ? med.drug_ids : med.drug_id ? [med.drug_id] : [];
    const mapping    = mappings?.find((m) => m.drug_id === med.drug_id || m.drug_ids?.includes(med.drug_id ?? ""));
    const ingredientDetails = medDrugIds
      .map((id) => { const drug = drugs.find((d) => d.id === id); if (!drug) return null; return `  INGREDIENT ${drug.name}:\n    Indication: ${drug.indication ?? "N/A"}\n    Side effects: ${drug.toxicity ?? "N/A"}\n    Half-life: ${drug.half_life ?? "N/A"}\n    Mechanism: ${drug.mechanism_of_action ?? "N/A"}`; })
      .filter(Boolean).join("\n");
    const isCombo     = med.is_combination ?? false;
    const ingredients = med.ingredients?.join(" + ") ?? "N/A";
    return `CURRENT MED: ${med.name}\n  PH brand: ${mapping?.ph_brand ?? "N/A"}\n  Dosage prescribed: ${med.dosage ?? "N/A"}\n  Combination: ${isCombo ? `Yes -- ${ingredients}` : "No"}\n  DrugBank IDs: ${medDrugIds.join(", ")}\n${ingredientDetails}`;
  }).join("\n\n");
}

// ─── 6. Fetch known interactions between patient's current meds ───────────────

async function fetchInteractionContext(meds: MedDoc[]): Promise<string> {
  const allIds = [...new Set(meds.flatMap((m) => m.is_combination && m.drug_ids?.length ? m.drug_ids : m.drug_id ? [m.drug_id] : []))];
  if (allIds.length < 2) return "";
  try {
    const pairs = allIds.flatMap((id) => allIds.filter((o) => o !== id).map((o) => `and(drug_id.eq.${id},interacts_with.eq.${o})`));
    const { data, error } = await supabase.from("drug_interactions").select("drug_id, interacts_with, description").or(pairs.join(","));
    if (error) { console.warn("⚠️ [Supabase] interactions:", error.message); return ""; }
    if (!data?.length) return "";
    return data.map((i) => `  ${i.drug_id} <-> ${i.interacts_with}: ${i.description ?? "No details"}`).join("\n");
  } catch (err: any) {
    console.error("❌ [Supabase] fetchInteractionContext:", err.message);
    return "";
  }
}

// ─── 7. Build system prompt ───────────────────────────────────────────────────
// Always fetches fresh data: profile + today's reminders + today's taken_logs.
// Called every sendChatMessage so the AI always sees the live schedule.

async function buildSystemPrompt(uid: string): Promise<string> {
  const profile = await getUserProfile(uid);
  const userData    = profile?.userData    ?? {};
  const medicalData = profile?.medicalData ?? {};

  const name       = userData.name        ?? "Patient";
  const gender     = userData.gender      ?? "unknown";
  const dob        = userData.dateOfBirth ?? "";
  const age        = calculateAge(dob);
  const bloodType  = medicalData.bloodType ?? "unknown";
  const height     = medicalData.height    ?? "unknown";
  const weight     = medicalData.weight    ?? "unknown";
  const notes      = medicalData.notes     ?? "";
  const allergies: string[]  = medicalData.allergies  ?? [];
  const conditions: string[] = medicalData.conditions ?? [];
  const meds = profile?.medications ?? [];

  const medSummary = meds.map((m) => {
    const parts = [m.name];
    if (m.dosage) parts.push(m.dosage);
    if (m.is_combination && m.ingredients?.length) parts.push(`(${m.ingredients.join(" + ")})`);
    return parts.join(" ");
  });

  console.log("📋 [Prompt] Building with:", { name, age, gender, bloodType, height, weight, conditions, allergies, medSummary });

  // Today's identifiers
  const today        = new Date();
  const todayKey     = today.toDateString(); // matches dateKey() in taken_logs
  const todayDate    = today.toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric" });
  const todayDayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][today.getDay()];

  // Fetch profile context + today's schedule data + reactions cache all in parallel
  const [medContext, interactionContext, takenSnap, remindersSnap, reactionsCacheSnap] = await Promise.all([
    fetchMedicationContext(meds),
    fetchInteractionContext(meds),
    getDocs(query(collection(db, "users", uid, "taken_logs"), where("dateKey", "==", todayKey))),
    getDocs(collection(db, "users", uid, "reminders")),
    getDoc(doc(db, "users", uid, "reactions_cache", "latest")),
  ]);

  // Filter reminders to today only
  const todayReminders = remindersSnap.docs
    .map((d) => ({ id: d.id, ...d.data() } as any))
    .filter((r: any) => {
      if (!r.enabled) return false;
      if (!r.days || r.days.length === 0) return true; // one-time reminder
      return r.days.includes(todayDayName);
    });

  const scheduledLines = todayReminders.length
    ? todayReminders.map((r: any) => `  - ${r.medicationName} ${r.medicationDosage} at ${r.time}`)
    : ["  None scheduled today"];

  const takenLines = takenSnap.docs.length
    ? takenSnap.docs.map((d) => { const l = d.data(); return `  - ${l.name} ${l.dosage ?? ""}${l.reminderId === "quick-take" ? " (quick dose)" : ""}`; })
    : ["  None taken yet"];

  const takenReminderIds = new Set(takenSnap.docs.map((d) => d.data().reminderId));
  const missedReminders  = todayReminders.filter((r: any) => !takenReminderIds.has(r.id));
  const missedLines      = missedReminders.map((r: any) => `  - ${r.medicationName} ${r.medicationDosage} (scheduled ${r.time})`);

  // Build reactions context from cached analysis (same data as the Reactions tab)
  let reactionsContext = "";
  if (reactionsCacheSnap.exists()) {
    const rc = reactionsCacheSnap.data();
    const interactionLines = (rc.interactions ?? []).map((i: any) =>
      `  - ${i.drugA} + ${i.drugB}: ${i.severity} -- ${i.description}`
    );
    const sideEffectLines = (rc.sideEffects ?? []).map((s: any) =>
      `  - ${s.medicationName}: ${s.summary}`
    );
    reactionsContext = [
      rc.summary ? `Overall: ${rc.summary}` : "",
      interactionLines.length ? `Interactions (${interactionLines.length}):\n${interactionLines.join("\n")}` : "No interactions found.",
      sideEffectLines.length ? `Side effects:\n${sideEffectLines.join("\n")}` : "",
    ].filter(Boolean).join("\n\n");
  }

  return `You are MEADGUARD, a professional clinical medication assistant in a mobile health app.
You have access to the patient's medical profile, a verified Philippine (PH) medication database,
and the patient's real-time medication schedule for today.
IMPORTANT: Only use drug information provided in the context. Never invent or assume drug data.

PATIENT PROFILE
Name: ${name}
Age: ${age} | Gender: ${gender} | Date of birth: ${dob}
Blood type: ${bloodType} | Height: ${height} cm | Weight: ${weight} kg
All active medications in profile (NOT necessarily all due today — use TODAY'S SCHEDULE below for what is due today): ${medSummary.length ? medSummary.join("; ") : "None recorded"}
Allergies: ${allergies.length ? allergies.join(", ") : "None recorded"}
Medical conditions: ${conditions.length ? conditions.join(", ") : "None recorded"}
${notes ? `Clinical notes: ${notes}` : ""}

TODAY'S SCHEDULE (${todayDate})
=========================================
Scheduled for today (${todayReminders.length} reminder${todayReminders.length !== 1 ? "s" : ""}):
${scheduledLines.join("\n")}

Already taken today (${takenSnap.docs.length} dose${takenSnap.docs.length !== 1 ? "s" : ""}):
${takenLines.join("\n")}

Missed -- scheduled but not taken yet (${missedReminders.length}):
${missedReminders.length ? missedLines.join("\n") : "  None missed -- all caught up!"}
=========================================

CRITICAL SCHEDULE RULES (OVERRIDE ALL OTHER CONTEXT):
- "Today's medications" = STRICTLY ONLY the ${todayReminders.length} item(s) in the scheduled list above.
- DO NOT include medications from "All active medications in profile" that are not in today's scheduled list.
- There are exactly ${todayReminders.length} medication(s) scheduled for today. Return exactly that many.
- Set each medication's "taken" field to true if it appears in "Already taken today", false otherwise.
- "Missed doses" = ONLY the ${missedReminders.length} item(s) in the missed list above.
- A medication not in today's scheduled list was NOT due today -- never report it.
- If no reminders are scheduled for today, say so honestly.

MEDICATION DATABASE (patient's current drugs with ingredient breakdown)
${medContext || "No database records found for current medications."}

KNOWN INTERACTIONS BETWEEN CURRENT MEDICATIONS
${interactionContext || "No interactions found between current medications."}

AI REACTIONS ANALYSIS (from Reactions tab — same data the patient sees):
${reactionsContext || "No reactions analysis available yet. Patient should open the Reactions tab to generate it."}
When asked about drug interactions or side effects, use the AI REACTIONS ANALYSIS above.
It already contains plain-language explanations — use them directly in your answer.

CLINICAL INSTRUCTIONS
- Always personalise answers to ${name}: ${age}-year-old ${gender}.
- Conditions: ${conditions.join(", ") || "none"} -- factor into every answer.
- Allergies: ${allergies.join(", ") || "none"} -- flag conflicts immediately.
- Weight ${weight} kg, height ${height} cm -- use for dosage context.
- When ADDITIONAL DRUG INFORMATION is provided below, use it to answer.
- For side effects and interactions, always refer to ingredient-level data (DrugBank names), not brand name alone.
- If a drug is not in the database context, say: "I don't have that drug in the database. Please consult your pharmacist."
- When a new drug is mentioned, check its interactions against the patient's current medications.
- Use PH brand names in responses so the patient recognises them.
- Keep responses concise and in plain language.
- End serious warnings with: "Please consult your doctor or pharmacist."
- Only decline questions clearly unrelated to health or medications (e.g. math, coding, trivia).
- Do NOT repeat the full patient profile unless asked.
- NEVER invent drug information. Only use what is in this prompt or additional context.

RESPONSE FORMAT
Respond ONLY with valid JSON. The "text" field must always be a non-empty string.
{
  "type": "text" | "medication" | "health" | "suggestion",
  "text": "Your main response -- always a non-empty string",
  "data": <optional -- omit if not needed>
}

data shapes:
- "medication"  -> [{ "name": string, "dosage": string, "time": string, "taken": boolean, "note": string }]
  RULE: For today's meds, return EXACTLY the ${todayReminders.length} item(s) from the scheduled list above.
  Do NOT add medications from "All active medications in profile" that aren't in the scheduled list.
  Set "taken": true for medications in the "Already taken" list, false otherwise.
- "health" (interactions) -> data MUST be { "interactions": [...] } -- NEVER put interactions at the top level outside of data
  Example: { "type": "health", "text": "...", "data": { "interactions": [{ "meds": ["DrugA","DrugB"], "severity": "moderate", "advice": "..." }] } }
- "health" (metrics)      -> [{ "type": string, "value": string, "unit": string, "trend": "up"|"down"|"stable" }]
- "suggestion"  -> string[]
- "text"        -> null`;
}

// ─── 8. Preload ───────────────────────────────────────────────────────────────
// Only validates the profile loads. Actual prompt is built fresh per message.

export async function preloadUserContext(uid: string): Promise<void> {
  if (!uid || cachedUid === uid) return;
  console.log("🔵 [OpenAI] Preloading context for uid:", uid);
  try {
    await getUserProfile(uid);
    cachedUid = uid;
    console.log("✅ [OpenAI] Context preloaded -- chat ready");
  } catch (err: any) {
    console.warn("⚠️ [OpenAI] Preload failed:", err.message);
    cachedUid = uid;
  }
}

export function invalidateCache(): void {
  cachedUid = null;
  console.log("🔄 [OpenAI] Cache cleared");
}

// ─── 9. Main chat function ────────────────────────────────────────────────────

export async function sendChatMessage(
  uid: string,
  history: ChatMessage[],
  userMessage: string,
): Promise<AIResponse> {
  try {
    // Build fresh prompt + run NLP in parallel for minimum latency
    const [freshPrompt, extractedDrugs] = await Promise.all([
      buildSystemPrompt(uid).catch(() => FALLBACK_PROMPT),
      extractDrugNamesFromMessage(userMessage),
    ]);

    // Get patient's drug IDs for interaction checking against new drugs
    const profile        = await getUserProfile(uid);
    const meds           = profile?.medications ?? [];
    const patientDrugIds = [
      ...new Set(meds.flatMap((m) => m.is_combination && m.drug_ids?.length ? m.drug_ids : m.drug_id ? [m.drug_id] : [])),
    ];

    const liveContext = await fetchLiveContext(extractedDrugs, patientDrugIds);

    const messages: ChatMessage[] = [
      { role: "system", content: freshPrompt },
      ...(liveContext
        ? [{
            role: "system" as const,
            content:
              `ADDITIONAL DRUG INFORMATION FROM DATABASE (source: Supabase -- verified):\n\n${liveContext}\n\n` +
              `Use this data to answer the patient's question. ` +
              `Side effects and interactions are based on the ingredient-level DrugBank data above.`,
          }]
        : []),
      ...history.slice(-8),
      { role: "user", content: userMessage },
    ];

    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({ model: MODEL, messages, max_tokens: 800, temperature: 0.3, response_format: { type: "json_object" } }),
    });

    if (!res.ok) {
      const err = await res.json();
      console.error("❌ [OpenAI] API error:", JSON.stringify(err));
      throw new Error(err?.error?.message ?? `OpenAI error ${res.status}`);
    }

    const json   = await res.json();
    const raw    = json.choices?.[0]?.message?.content ?? "{}";
    console.log("✅ [OpenAI] Response:", raw.slice(0, 300));
    const parsed = JSON.parse(raw);

    // Normalise data FIRST -- GPT sometimes returns interactions at top level instead of in data
    let data = parsed.data ?? undefined;
    if (parsed.type === "health" && !data && parsed.interactions) {
      data = { interactions: parsed.interactions };
    }
    // Also handle suggestion type returned at top level
    if (parsed.type === "suggestion" && !data && Array.isArray(parsed.suggestions)) {
      data = parsed.suggestions;
    }

    // Now compute text with normalised data available
    const text =
      typeof parsed.text === "string" && parsed.text.trim()
        ? parsed.text
        : data ? "Here is the information you requested." : "I couldn't generate a response. Please try again.";

    return { type: parsed.type ?? "text", text, data };
  } catch (err: any) {
    console.error("❌ [OpenAI] sendChatMessage failed:", err.message);
    return { type: "text", text: `Error: ${err.message}` };
  }
}

// ─── 10. Mark medication taken ────────────────────────────────────────────────

export async function markMedicationTaken(uid: string, medicationId: string): Promise<void> {
  try {
    await updateDoc(doc(db, "users", uid, "medications", medicationId), { taken: true });
    console.log("✅ [Firebase] Marked taken:", medicationId);
  } catch (err: any) {
    console.error("❌ [Firebase] markMedicationTaken:", err.message);
  }
}

// =============================================================================
// REACTIONS ANALYSIS
// =============================================================================

export interface AISideEffect {
  medicationName:  string;
  medicationId:    string;
  summary:         string;
  common:          string[];
  serious:         string[];
  profileWarnings: AIProfileWarning[];
}

export interface AIInteraction {
  drugA:           string;
  drugB:           string;
  severity:        "mild" | "moderate" | "severe";
  severityReason:  string;
  description:     string;
  recommendation:  string;
}

export interface AIProfileWarning {
  type:     "pregnancy" | "breastfeeding" | "condition" | "age" | "general";
  warning:  string;
  severity: "info" | "caution" | "danger";
}

export interface AICommunityReport {
  symptom:     string;
  reportCount: number;
  avgSeverity: number;
  medications: string[];
  note:        string;
}

export interface ReactionsAnalysis {
  sideEffects:      AISideEffect[];
  interactions:     AIInteraction[];
  profileWarnings:  AIProfileWarning[];
  communityReports: AICommunityReport[];
  summary:          string;
  lastUpdated:      Date;
}

async function fetchCommunityLogs(userConditions: string[], currentUid: string): Promise<string> {
  if (!userConditions.length) return "";
  try {
    const usersSnap = await getDocs(collection(db, "users"));
    const counts: Record<string, { total: number; severitySum: number }> = {};
    for (const userDoc of usersSnap.docs) {
      if (userDoc.id === currentUid) continue;
      const data       = userDoc.data();
      const conditions = (data?.medicalData?.conditions ?? []) as string[];
      const shared     = conditions.filter((c) => userConditions.some((uc) => uc.toLowerCase() === c.toLowerCase()));
      if (!shared.length) continue;
      const logsSnap = await getDocs(collection(db, "users", userDoc.id, "symptom_logs"));
      for (const logDoc of logsSnap.docs) {
        const log = logDoc.data();
        if (!log.symptom) continue;
        const key = log.symptom.toLowerCase().trim();
        if (!counts[key]) counts[key] = { total: 0, severitySum: 0 };
        counts[key].total++;
        counts[key].severitySum += log.severity ?? 1;
      }
    }
    const sorted = Object.entries(counts).sort((a, b) => b[1].total - a[1].total).slice(0, 10);
    if (!sorted.length) return "";
    return sorted.map(([symptom, d]) => `- "${symptom}": reported ${d.total} time(s), avg severity ${(d.severitySum / d.total).toFixed(1)}/5`).join("\n");
  } catch (err: any) {
    console.warn("[Community] fetchCommunityLogs:", err.message);
    return "";
  }
}

export async function generateReactionsAnalysis(uid: string, medications: MedDoc[]): Promise<ReactionsAnalysis> {
  const activeMeds = medications.filter((m) => m.active !== false && m.drug_id);
  if (!activeMeds.length) {
    return { sideEffects: [], interactions: [], profileWarnings: [], communityReports: [], summary: "No medications with database records found.", lastUpdated: new Date() };
  }

  const profile     = await getUserProfile(uid);
  const userData    = profile?.userData    ?? {};
  const medicalData = profile?.medicalData ?? {};
  const name            = userData.name          ?? "Patient";
  const gender          = userData.gender        ?? "unknown";
  const dob             = userData.dateOfBirth   ?? "";
  const age             = calculateAge(dob);
  const bloodType       = medicalData.bloodType  ?? "unknown";
  const height          = medicalData.height     ?? "unknown";
  const weight          = medicalData.weight     ?? "unknown";
  const conditions      = (medicalData.conditions  ?? []) as string[];
  const allergies       = (medicalData.allergies   ?? []) as string[];
  const isPregnant      = (medicalData.isPregnant      ?? false) as boolean;
  const isBreastfeeding = (medicalData.isBreastfeeding ?? false) as boolean;
  const trimester       = (medicalData.trimester       ?? null)  as number | null;

  const [medContext, interactionContext, userLogsSnap, communityData] = await Promise.all([
    fetchMedicationContext(activeMeds),
    fetchInteractionContext(activeMeds),
    getDocs(collection(db, "users", uid, "symptom_logs")),
    fetchCommunityLogs(conditions, uid),
  ]);

  const userLogs = userLogsSnap.docs.slice(0, 20)
    .map((d) => { const l = d.data(); return `- ${l.symptom} (severity ${l.severity}/5)${l.note ? `: ${l.note}` : ""}`; })
    .join("\n") || "None logged yet.";

  const medSummary = activeMeds.map((m) => {
    const parts = [m.name];
    if (m.dosage) parts.push(m.dosage);
    if (m.is_combination && m.ingredients?.length) parts.push(`-- combination of: ${m.ingredients.join(" + ")}`);
    const ids = m.drug_ids?.length ? m.drug_ids : m.drug_id ? [m.drug_id] : [];
    if (ids.length) parts.push(`[DrugBank IDs: ${ids.join(", ")}]`);
    return parts.join(" ");
  }).join("\n");

  const pregnancyRule = !isPregnant && !isBreastfeeding
    ? "This patient is NOT pregnant and NOT breastfeeding. Do NOT include any pregnancy or breastfeeding warnings at all. profileWarnings must be [] and each sideEffect.profileWarnings must be []."
    : `This patient IS ${isPregnant ? "pregnant" + (trimester ? " (trimester " + trimester + ")" : "") : ""}${isPregnant && isBreastfeeding ? " and " : ""}${isBreastfeeding ? "breastfeeding" : ""}. Flag ALL relevant risks.`;

  const prompt = `You are a clinical pharmacist AI generating a medication safety analysis for a patient mobile app.
Use ONLY the database data provided. Never invent side effects or interactions.

PATIENT PROFILE
Name: ${name} | Age: ${age} | Gender: ${gender}
Blood type: ${bloodType} | Height: ${height} cm | Weight: ${weight} kg
Conditions: ${conditions.join(", ") || "None"}
Allergies: ${allergies.join(", ") || "None"}
Pregnant: ${isPregnant ? `Yes${trimester ? ` (trimester ${trimester})` : ""}` : "No"}
Breastfeeding: ${isBreastfeeding ? "Yes" : "No"}

CURRENT MEDICATIONS (always use the FULL name):
${medSummary}

MEDICATION DATABASE (ingredient-level data from Supabase)
${medContext || "No drug data found."}

KNOWN INTERACTIONS FROM DATABASE
${interactionContext || "No interactions found."}

PATIENT SYMPTOM LOG
${userLogs}

COMMUNITY REPORTS (anonymized, users with same conditions: ${conditions.join(", ") || "none"})
${communityData || "No community data available."}

RULES:
- severity: mild=minor, moderate=needs monitoring, severe=seek immediate care
- For conditions (${conditions.join(", ")}): flag drugs that worsen them
- Community reports are anecdotal -- label as "reported by users with similar conditions"
- Plain language -- no medical jargon
- If no data available for a drug, say so honestly
- ${pregnancyRule}

Respond ONLY with valid JSON (no markdown):
{
  "sideEffects": [{ "medicationName": "FULL medication name", "medicationId": "primary drug_id", "summary": "1-2 sentence plain-language safety summary", "common": ["side effect 1"], "serious": ["serious side effect 1"], "profileWarnings": [] }],
  "interactions": [{ "drugA": "FULL medication name", "drugB": "FULL medication name", "severity": "mild|moderate|severe", "severityReason": "brief reason", "description": "plain-language explanation", "recommendation": "what the patient should do" }],
  "profileWarnings": [],
  "communityReports": [{ "symptom": "symptom name", "reportCount": 0, "avgSeverity": 0.0, "medications": ["FULL medication name"], "note": "AI context about this symptom" }],
  "summary": "2-3 sentence overall safety summary for this patient"
}`;

  try {
    console.log("[Reactions] Generating AI analysis...");
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: prompt }], max_tokens: 2000, temperature: 0.2, response_format: { type: "json_object" } }),
    });
    if (!res.ok) { const err = await res.json(); throw new Error(err?.error?.message ?? `OpenAI error ${res.status}`); }
    const json   = await res.json();
    const raw    = json.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);
    console.log("[Reactions] Analysis complete");
    const result: ReactionsAnalysis = {
      sideEffects:      parsed.sideEffects      ?? [],
      interactions:     parsed.interactions     ?? [],
      profileWarnings:  parsed.profileWarnings  ?? [],
      communityReports: parsed.communityReports ?? [],
      summary:          parsed.summary          ?? "",
      lastUpdated:      new Date(),
    };
    // Persist to reactions_cache so the chatbot can read the same data
    try {
      await setDoc(doc(db, "users", uid, "reactions_cache", "latest"), {
        ...result,
        lastUpdated: new Date().toISOString(),
      });
    } catch (cacheErr: any) {
      console.warn("[Reactions] Cache write failed:", cacheErr.message);
    }
    return result;
  } catch (err: any) {
    console.error("[Reactions] generateReactionsAnalysis:", err.message);
    throw err;
  }
}