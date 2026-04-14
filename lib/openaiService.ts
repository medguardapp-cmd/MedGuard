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
//   2. Gibberish / off-topic guard  -- fast check before any expensive calls
//   3. NLP pre-call       -- GPT extracts + FUZZY-CORRECTS drug names from user message
//   4. Fuzzy mapping      -- Levenshtein against ph_medicine_mapping brand/generic list
//   5. Mapping lookup     -- ph_medicine_mapping -> get ingredients + drug_ids
//   6. Supabase drugs     -- fetch full clinical data using drug_ids
//   7. Supabase interactions -- check drug_ids against patient's current meds
//   8. GPT main call      -- answers using DB data + patient profile + live schedule

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
const MODEL = "gpt-4o-mini";

let cachedUid: string | null = null;

// Cache all known brand + generic names from ph_medicine_mapping for fuzzy matching.
// Populated once on first use and refreshed if stale (>10 min).
let knownDrugNames: { name: string; canonical: string }[] = [];
let knownDrugNamesLoadedAt = 0;
const DRUG_NAMES_TTL_MS = 10 * 60 * 1000; // 10 minutes

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

// ─── Levenshtein distance ─────────────────────────────────────────────────────
// Used for fuzzy drug name matching (handles typos like "bigesic" → "Biogesic").

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1].toLowerCase() === b[j - 1].toLowerCase()
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

// Returns the closest known drug name if within the edit-distance threshold,
// otherwise returns the original name unchanged.
function fuzzyCorrectDrugName(input: string): string {
  if (!knownDrugNames.length) return input;
  const lower = input.toLowerCase().trim();
  // Allow at most ceil(len/4) edits — roughly 1 per 4 chars (e.g. 7-char word → 2 edits)
  const maxDist = Math.ceil(lower.length / 4);
  let best: { dist: number; canonical: string } = {
    dist: Infinity,
    canonical: input,
  };
  for (const { name, canonical } of knownDrugNames) {
    const dist = levenshtein(lower, name.toLowerCase());
    if (dist < best.dist) best = { dist, canonical };
  }
  if (best.dist <= maxDist && best.dist > 0) {
    console.log(
      `🔤 [Fuzzy] "${input}" → "${best.canonical}" (dist ${best.dist})`,
    );
    return best.canonical;
  }
  return input;
}

// Populate knownDrugNames from ph_medicine_mapping (brand + generic columns).
async function ensureDrugNamesCache(): Promise<void> {
  const now = Date.now();
  if (knownDrugNames.length && now - knownDrugNamesLoadedAt < DRUG_NAMES_TTL_MS)
    return;
  try {
    const { data, error } = await supabase
      .from("ph_medicine_mapping")
      .select("ph_brand, generic_name")
      .limit(2000);
    if (error) {
      console.warn("⚠️ [Fuzzy] Cache load failed:", error.message);
      return;
    }
    const entries: { name: string; canonical: string }[] = [];
    for (const row of data ?? []) {
      if (row.ph_brand)
        entries.push({
          name: row.ph_brand.toLowerCase(),
          canonical: row.ph_brand,
        });
      if (row.generic_name)
        entries.push({
          name: row.generic_name.toLowerCase(),
          canonical: row.generic_name,
        });
    }
    // Deduplicate by lowercase name
    const seen = new Set<string>();
    knownDrugNames = entries.filter(({ name }) => {
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    });
    knownDrugNamesLoadedAt = now;
    console.log(`✅ [Fuzzy] Loaded ${knownDrugNames.length} known drug names`);
  } catch (err: any) {
    console.warn("⚠️ [Fuzzy] ensureDrugNamesCache:", err.message);
  }
}

// ─── Gibberish / off-topic guard ──────────────────────────────────────────────
//
// Three checks — ALL fast and local, no API call:
//   1. Gibberish: high consonant-cluster density with no vowels → meaningless input
//   2. Very short non-word: 1-3 chars that aren't a known abbreviation
//   3. Off-topic via keyword blacklist (the LLM handles edge cases gracefully
//      but this stops obvious non-health queries before any API calls fire)

const HEALTH_KEYWORDS_RE =
  /\b(med(ication|s|icine)?|drug|dose|dosage|pill|tablet|capsule|injection|syrup|vitamin|supplement|side.?effect|interact|allerg|prescri|pharmacist|doctor|nurse|hospital|clinic|symptom|condition|treat|therapy|health|pain|fever|headache|cough|cold|flu|blood|pressure|sugar|glucose|diabetes|hypertension|heart|kidney|liver|stomach|nausea|vomit|diarrhea|constipat|infect|antibiotic|antiviral|antifungal|miss|refill|reminder|schedule|taken|dose|overdose|poison|emergency|pregnant|breastfeed|allerg|biogesic|paracetamol|ibuprofen|aspirin|amoxicillin|cetirizine|losartan|metformin|atorvastatin|omeprazole|salbutamol|amlodipine|simvastatin|azithromycin)\b/i;

// Simple consonant-run detector — 5+ consonants in a row with no vowels signals gibberish
const GIBBERISH_RE = /[^aeiou\s\d\W]{5,}/i;

function classifyInput(text: string): "health" | "off-topic" | "gibberish" {
  const trimmed = text.trim();

  // Gibberish: mostly consonants, no spaces, no meaning
  const noSpaces = trimmed.replace(/\s+/g, "");
  const vowelRatio =
    (noSpaces.match(/[aeiou]/gi) ?? []).length / (noSpaces.length || 1);
  if (vowelRatio < 0.1 && noSpaces.length > 4) return "gibberish";
  if (GIBBERISH_RE.test(trimmed) && !HEALTH_KEYWORDS_RE.test(trimmed))
    return "gibberish";

  // Very short input with no recognisable health content
  if (trimmed.length < 4 && !HEALTH_KEYWORDS_RE.test(trimmed))
    return "gibberish";

  // Off-topic keyword patterns
  const offTopicRe =
    /\b(weather|recipe|cook|sport|football|basketball|code|program|javascript|python|math|calcul|history|geography|movie|music|song|game|politics|stock|crypto|bitcoin|finance|invest|travel|hotel|flight|restaurant|joke|trivia|news)\b/i;
  if (offTopicRe.test(trimmed) && !HEALTH_KEYWORDS_RE.test(trimmed))
    return "off-topic";

  return "health";
}

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
  const brands = mapping?.ph_brand ?? "N/A";
  const genericName = mapping?.generic_name ?? drug?.name ?? "N/A";
  const isCombo = mapping?.is_combination ?? false;
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

// ─── 1. NLP drug name extraction with fuzzy correction ───────────────────────
//
// Step A — GPT extracts any drug/vitamin names mentioned in the message.
// Step B — Each extracted name is fuzzy-matched against knownDrugNames so that
//          typos ("bigesic", "biogesick", "paracetamole") resolve to the correct
//          canonical name before the Supabase lookup fires.

async function extractDrugNamesFromMessage(message: string): Promise<string[]> {
  // Populate fuzzy cache in parallel while GPT runs
  await ensureDrugNamesCache();

  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 80,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              `You are a drug name extractor for a Philippine medication app.\n` +
              `Extract any medication, drug, vitamin, or supplement names from the user message.\n` +
              `Return ONLY valid JSON: { "drugs": ["name1", "name2"] }\n` +
              `If no drug names found, return: { "drugs": [] }\n` +
              `Rules:\n` +
              `- Include brand names (Biogesic, Medicol, Diane 35) AND generic names (paracetamol, ibuprofen)\n` +
              `- Include vitamins and supplements (Vitamin C, iron, folic acid)\n` +
              `- Include misspelled or approximate names — extract them as-is; do NOT correct spelling here\n` +
              `- Do NOT include drug classes (antibiotic, painkiller) -- only specific names\n` +
              `- Keep names exactly as the user wrote them`,
          },
          { role: "user", content: message },
        ],
      }),
    });
    if (!res.ok) return [];
    const json = await res.json();
    const raw = json.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);
    const rawDrugs: string[] = parsed.drugs ?? [];

    // Fuzzy-correct each extracted name against known PH drug names
    const corrected = rawDrugs.map(fuzzyCorrectDrugName);
    // Deduplicate after correction (e.g. "bigesic" + "biogesic" → one "Biogesic")
    const unique = [...new Set(corrected)];

    console.log(
      `🧠 [NLP] Raw: [${rawDrugs.join(", ")}] → Corrected: [${unique.join(", ")}]`,
    );
    return unique;
  } catch (err: any) {
    console.warn("⚠️ [NLP] Extraction failed:", err.message);
    return [];
  }
}

// ─── 2. Look up a drug by name ────────────────────────────────────────────────

async function lookupDrugByName(
  drugName: string,
  patientDrugIds: string[] = [],
): Promise<string> {
  if (!drugName || drugName.length < 2) return "";
  console.log(`🔵 [Supabase] Looking up: "${drugName}"`);
  try {
    const { data: mappings, error: mapErr } = await supabase
      .from("ph_medicine_mapping")
      .select(
        "id, drug_id, ph_brand, generic_name, drug_ids, ingredients, is_combination",
      )
      .or(`ph_brand.ilike.%${drugName}%,generic_name.ilike.%${drugName}%`)
      .limit(5);
    if (mapErr) console.warn("⚠️ [Supabase] mapping:", mapErr.message);

    let allIngredientIds: string[] = [];
    if (mappings?.length) {
      allIngredientIds = [
        ...new Set(
          mappings.flatMap((m) =>
            m.drug_ids?.length ? m.drug_ids : m.drug_id ? [m.drug_id] : [],
          ),
        ),
      ];
    } else {
      console.log(
        `🔵 [Supabase] No mapping -- searching drugs table: "${drugName}"`,
      );
      const { data: byName } = await supabase
        .from("drugs")
        .select("id, name")
        .ilike("name", `%${drugName}%`)
        .limit(3);
      if (!byName?.length) {
        console.log(`ℹ️ [Supabase] No DB results for: "${drugName}"`);
        return "";
      }
      allIngredientIds = byName.map((d) => d.id);
    }

    const drugs = await fetchDrugsByIds(allIngredientIds);
    let interactionText = "";
    if (patientDrugIds.length && allIngredientIds.length) {
      const pairs = allIngredientIds.flatMap((id) =>
        patientDrugIds
          .filter((o) => o !== id)
          .map((o) => `and(drug_id.eq.${id},interacts_with.eq.${o})`),
      );
      if (pairs.length) {
        const { data: interactions } = await supabase
          .from("drug_interactions")
          .select("drug_id, interacts_with, description")
          .or(pairs.join(","));
        if (interactions?.length) {
          interactionText =
            "\n  INTERACTIONS WITH PATIENT'S CURRENT MEDS:\n" +
            interactions
              .map(
                (i) =>
                  `    - ${i.drug_id} <-> ${i.interacts_with}: ${i.description ?? "See pharmacist"}`,
              )
              .join("\n");
        }
      }
    }

    if (!mappings?.length && drugs.length)
      return drugs.map((d) => formatDrug(d, null, "DRUG INFO")).join("\n\n");
    console.log(
      `✅ [Supabase] Found ${mappings!.length} mapping(s) for "${drugName}"`,
    );
    const seen = new Set<string>();
    return (mappings ?? [])
      .filter((m) => {
        const key = m.generic_name ?? m.ph_brand;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((m) => {
        const primaryId = m.drug_ids?.[0] ?? m.drug_id;
        const drug = drugs.find((d) => d.id === primaryId) ?? drugs[0] ?? null;
        return formatDrug(drug, m, "DRUG INFO") + interactionText;
      })
      .join("\n\n");
  } catch (err: any) {
    console.error("❌ [Supabase] lookupDrugByName:", err.message);
    return "";
  }
}

// ─── 3. Fetch live context for NLP-extracted drug names ──────────────────────

async function fetchLiveContext(
  drugNames: string[],
  patientDrugIds: string[],
): Promise<string> {
  if (!drugNames.length) return "";
  const results = await Promise.all(
    drugNames.map((n) => lookupDrugByName(n, patientDrugIds)),
  );
  const found = results.filter(Boolean);
  if (found.length)
    console.log(
      `✅ [Supabase] Live context ready for: ${drugNames.join(", ")}`,
    );
  return found.join("\n\n");
}

// ─── 4. Fetch Firestore profile ───────────────────────────────────────────────

async function getUserProfile(uid: string) {
  if (!uid) return null;
  try {
    const userSnap = await getDoc(doc(db, "users", uid));
    if (!userSnap.exists()) return null;
    const root = userSnap.data();
    const userData = root?.userData ?? {};
    const medicalData = root?.medicalData ?? {};
    const medsSnap = await getDocs(collection(db, "users", uid, "medications"));
    const medications: MedDoc[] = medsSnap.docs
      .map((d) => ({ ...(d.data() as MedDoc), id: d.id }))
      .filter((m) => m.active !== false);
    console.log("✅ [Firebase] Profile loaded:", {
      name: userData.name,
      conditions: medicalData.conditions,
      meds: medications.map((m) => m.name),
    });
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
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return String(age);
  } catch {
    return "unknown";
  }
}

// ─── 5. Fetch drug context for patient's current medications ─────────────────

async function fetchMedicationContext(meds: MedDoc[]): Promise<string> {
  if (!meds.length) return "";
  const allIngredientIds = [
    ...new Set(
      meds.flatMap((m) =>
        m.is_combination && m.drug_ids?.length
          ? m.drug_ids
          : m.drug_id
            ? [m.drug_id]
            : [],
      ),
    ),
  ];
  if (!allIngredientIds.length) return "";
  console.log("🔵 [Supabase] Profile drug IDs:", allIngredientIds);
  const [{ data: mappings }, drugs] = await Promise.all([
    supabase
      .from("ph_medicine_mapping")
      .select(
        "id, drug_id, ph_brand, generic_name, drug_ids, ingredients, is_combination",
      )
      .or(allIngredientIds.map((id) => `drug_id.eq.${id}`).join(",")),
    fetchDrugsByIds(allIngredientIds),
  ]);
  return meds
    .map((med) => {
      const medDrugIds =
        med.is_combination && med.drug_ids?.length
          ? med.drug_ids
          : med.drug_id
            ? [med.drug_id]
            : [];
      const mapping = mappings?.find(
        (m) =>
          m.drug_id === med.drug_id || m.drug_ids?.includes(med.drug_id ?? ""),
      );
      const ingredientDetails = medDrugIds
        .map((id) => {
          const drug = drugs.find((d) => d.id === id);
          if (!drug) return null;
          return `  INGREDIENT ${drug.name}:\n    Indication: ${drug.indication ?? "N/A"}\n    Side effects: ${drug.toxicity ?? "N/A"}\n    Half-life: ${drug.half_life ?? "N/A"}\n    Mechanism: ${drug.mechanism_of_action ?? "N/A"}`;
        })
        .filter(Boolean)
        .join("\n");
      const isCombo = med.is_combination ?? false;
      const ingredients = med.ingredients?.join(" + ") ?? "N/A";
      return `CURRENT MED: ${med.name}\n  PH brand: ${mapping?.ph_brand ?? "N/A"}\n  Dosage prescribed: ${med.dosage ?? "N/A"}\n  Combination: ${isCombo ? `Yes -- ${ingredients}` : "No"}\n  DrugBank IDs: ${medDrugIds.join(", ")}\n${ingredientDetails}`;
    })
    .join("\n\n");
}

// ─── 6. Fetch known interactions between patient's current meds ───────────────

async function fetchInteractionContext(meds: MedDoc[]): Promise<string> {
  const allIds = [
    ...new Set(
      meds.flatMap((m) =>
        m.is_combination && m.drug_ids?.length
          ? m.drug_ids
          : m.drug_id
            ? [m.drug_id]
            : [],
      ),
    ),
  ];
  if (allIds.length < 2) return "";
  try {
    const pairs = allIds.flatMap((id) =>
      allIds
        .filter((o) => o !== id)
        .map((o) => `and(drug_id.eq.${id},interacts_with.eq.${o})`),
    );
    const { data, error } = await supabase
      .from("drug_interactions")
      .select("drug_id, interacts_with, description")
      .or(pairs.join(","));
    if (error) {
      console.warn("⚠️ [Supabase] interactions:", error.message);
      return "";
    }
    if (!data?.length) return "";
    return data
      .map(
        (i) =>
          `  ${i.drug_id} <-> ${i.interacts_with}: ${i.description ?? "No details"}`,
      )
      .join("\n");
  } catch (err: any) {
    console.error("❌ [Supabase] fetchInteractionContext:", err.message);
    return "";
  }
}

// ─── 7. Build system prompt ───────────────────────────────────────────────────

async function buildSystemPrompt(uid: string): Promise<string> {
  const profile = await getUserProfile(uid);
  const userData = profile?.userData ?? {};
  const medicalData = profile?.medicalData ?? {};

  const name = userData.name ?? "Patient";
  const gender = userData.gender ?? "unknown";
  const dob = userData.dateOfBirth ?? "";
  const age = calculateAge(dob);
  const bloodType = medicalData.bloodType ?? "unknown";
  const height = medicalData.height ?? "unknown";
  const weight = medicalData.weight ?? "unknown";
  const notes = medicalData.notes ?? "";
  const allergies: string[] = medicalData.allergies ?? [];
  const conditions: string[] = medicalData.conditions ?? [];
  const meds = profile?.medications ?? [];

  const medSummary = meds.map((m) => {
    const parts = [m.name];
    if (m.dosage) parts.push(m.dosage);
    if (m.is_combination && m.ingredients?.length)
      parts.push(`(${m.ingredients.join(" + ")})`);
    return parts.join(" ");
  });

  console.log("📋 [Prompt] Building with:", {
    name,
    age,
    gender,
    bloodType,
    height,
    weight,
    conditions,
    allergies,
    medSummary,
  });

  const today = new Date();
  const todayKey = today.toDateString();
  const todayDate = today.toLocaleDateString("en-PH", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const todayDayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
    today.getDay()
  ];

  const [
    medContext,
    interactionContext,
    takenSnap,
    remindersSnap,
    reactionsCacheSnap,
  ] = await Promise.all([
    fetchMedicationContext(meds),
    fetchInteractionContext(meds),
    getDocs(
      query(
        collection(db, "users", uid, "taken_logs"),
        where("dateKey", "==", todayKey),
      ),
    ),
    getDocs(collection(db, "users", uid, "reminders")),
    getDoc(doc(db, "users", uid, "reactions_cache", "latest")),
  ]);

  const todayReminders = remindersSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as any)
    .filter((r: any) => {
      if (!r.enabled) return false;
      if (!r.days || r.days.length === 0) return true;
      return r.days.includes(todayDayName);
    });

  const scheduledLines = todayReminders.length
    ? todayReminders.map(
        (r: any) =>
          `  - ${r.medicationName} ${r.medicationDosage} at ${r.time}`,
      )
    : ["  None scheduled today"];

  const takenLines = takenSnap.docs.length
    ? takenSnap.docs.map((d) => {
        const l = d.data();
        return `  - ${l.name} ${l.dosage ?? ""}${l.reminderId === "quick-take" ? " (quick dose)" : ""}`;
      })
    : ["  None taken yet"];

  const takenReminderIds = new Set(
    takenSnap.docs.map((d) => d.data().reminderId),
  );
  const missedReminders = todayReminders.filter(
    (r: any) => !takenReminderIds.has(r.id),
  );
  const missedLines = missedReminders.map(
    (r: any) =>
      `  - ${r.medicationName} ${r.medicationDosage} (scheduled ${r.time})`,
  );

  let reactionsContext = "";
  if (reactionsCacheSnap.exists()) {
    const rc = reactionsCacheSnap.data();
    const interactionLines = (rc.interactions ?? []).map(
      (i: any) =>
        `  - ${i.drugA} + ${i.drugB}: ${i.severity} -- ${i.description}`,
    );
    const sideEffectLines = (rc.sideEffects ?? []).map(
      (s: any) => `  - ${s.medicationName}: ${s.summary}`,
    );
    reactionsContext = [
      rc.summary ? `Overall: ${rc.summary}` : "",
      interactionLines.length
        ? `Interactions (${interactionLines.length}):\n${interactionLines.join("\n")}`
        : "No interactions found.",
      sideEffectLines.length
        ? `Side effects:\n${sideEffectLines.join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return `You are MEADGUARD, a professional clinical medication assistant in a mobile health app.
You have access to the patient's medical profile, a verified Philippine (PH) medication database,
and the patient's real-time medication schedule for today.

════════════════════════════════════════════════════
DATABASE-FIRST RULES (HIGHEST PRIORITY — NEVER OVERRIDE)
════════════════════════════════════════════════════
1. ALL drug information MUST come from the database context provided in this prompt
   or from ADDITIONAL DRUG INFORMATION blocks injected by the system.
2. NEVER invent, assume, or hallucinate drug names, side effects, dosages,
   interactions, or any clinical data. If it is not in the context, say:
   "I don't have that drug in the database. Please consult your pharmacist."
3. When the database context IS provided, use it VERBATIM for clinical facts.
   You may rephrase for clarity but must not change the clinical meaning.
4. You are a MEDICATION AND HEALTH assistant ONLY.
   - If the user's message is clearly unrelated to medications, health, symptoms,
     or medical conditions, respond politely that you can only help with
     medication and health-related questions.
   - If the user's message appears to be gibberish, typos with no recognisable
     health term, or completely unintelligible, ask them to rephrase clearly.
5. When a drug name appears misspelled but a corrected name is provided in
   ADDITIONAL DRUG INFORMATION, use the corrected (database) name in your response
   and silently treat it as the intended drug. Do not lecture the patient about spelling.
════════════════════════════════════════════════════

PATIENT PROFILE
Name: ${name}
Age: ${age} | Gender: ${gender} | Date of birth: ${dob}
Blood type: ${bloodType} | Height: ${height} cm | Weight: ${weight} kg
All active medications in profile (NOT necessarily all due today — use TODAY'S SCHEDULE below): ${medSummary.length ? medSummary.join("; ") : "None recorded"}
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
- When ADDITIONAL DRUG INFORMATION is provided below, use it to answer the question.
  That data was fetched from the database specifically for this query — treat it as ground truth.
- For side effects and interactions, always refer to ingredient-level data (DrugBank names), not brand name alone.
- Use PH brand names in responses so the patient recognises them.
- Keep responses concise and in plain language.
- End serious warnings with: "Please consult your doctor or pharmacist."
- Do NOT repeat the full patient profile unless asked.
- NEVER invent drug information. Only use what is in this prompt or additional context.

SCOPE RULES
- You ONLY answer questions about: medications, health conditions, symptoms, drug interactions,
  dosages, side effects, medical reminders, and general wellness advice.
- For ANYTHING outside this scope (weather, recipes, coding, sports, finance, etc.),
  respond with type "text" and politely explain you are a medication assistant only.
- For gibberish or completely unintelligible input, respond with type "text" asking
  the user to rephrase their question about their medications or health.

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
- "health" (interactions) -> data MUST be { "interactions": [...] } -- NEVER put interactions at the top level
  Example: { "type": "health", "text": "...", "data": { "interactions": [{ "meds": ["DrugA","DrugB"], "severity": "moderate", "advice": "..." }] } }
- "health" (metrics)      -> [{ "type": string, "value": string, "unit": string, "trend": "up"|"down"|"stable" }]
- "suggestion"  -> string[]
- "text"        -> null`;
}

// ─── 8. Preload ───────────────────────────────────────────────────────────────

export async function preloadUserContext(uid: string): Promise<void> {
  if (!uid || cachedUid === uid) return;
  console.log("🔵 [OpenAI] Preloading context for uid:", uid);
  try {
    // Preload profile AND drug names cache in parallel
    await Promise.all([getUserProfile(uid), ensureDrugNamesCache()]);
    cachedUid = uid;
    console.log("✅ [OpenAI] Context preloaded -- chat ready");
  } catch (err: any) {
    console.warn("⚠️ [OpenAI] Preload failed:", err.message);
    cachedUid = uid;
  }
}

export function invalidateCache(): void {
  cachedUid = null;
  knownDrugNames = [];
  knownDrugNamesLoadedAt = 0;
  console.log("🔄 [OpenAI] Cache cleared");
}

// ─── 9. Main chat function ────────────────────────────────────────────────────

export async function sendChatMessage(
  uid: string,
  history: ChatMessage[],
  userMessage: string,
): Promise<AIResponse> {
  try {
    // ── Step 0: Fast local guard (no API calls) ─────────────────────────────
    const inputClass = classifyInput(userMessage);

    if (inputClass === "gibberish") {
      return {
        type: "text",
        text: "I'm not sure I understood that. Could you rephrase your question? I'm here to help with your medications and health. 😊",
      };
    }

    if (inputClass === "off-topic") {
      return {
        type: "text",
        text: "I'm MEADGUARD, your medication assistant. I can only help with questions about your medications, health conditions, symptoms, or drug information. Is there anything health-related I can help you with?",
      };
    }

    // ── Step 1: Build fresh prompt + NLP extraction in parallel ────────────
    const [freshPrompt, extractedDrugs] = await Promise.all([
      buildSystemPrompt(uid).catch(() => FALLBACK_PROMPT),
      extractDrugNamesFromMessage(userMessage),
    ]);

    // ── Step 2: Get patient drug IDs for interaction checking ───────────────
    const profile = await getUserProfile(uid);
    const meds = profile?.medications ?? [];
    const patientDrugIds = [
      ...new Set(
        meds.flatMap((m) =>
          m.is_combination && m.drug_ids?.length
            ? m.drug_ids
            : m.drug_id
              ? [m.drug_id]
              : [],
        ),
      ),
    ];

    // ── Step 3: Fetch DB context for mentioned drugs ────────────────────────
    const liveContext = await fetchLiveContext(extractedDrugs, patientDrugIds);

    // ── Step 4: Build messages array ────────────────────────────────────────
    const messages: ChatMessage[] = [
      { role: "system", content: freshPrompt },
      ...(liveContext
        ? [
            {
              role: "system" as const,
              content:
                `ADDITIONAL DRUG INFORMATION FROM DATABASE (source: Supabase -- verified, DB-first):\n\n` +
                `${liveContext}\n\n` +
                `IMPORTANT: The drug name(s) above are the CORRECT canonical names from the database. ` +
                `If the patient typed a slightly different spelling, use the name(s) shown above in your response. ` +
                `Use this data as the sole source of truth for side effects, interactions, and clinical facts. ` +
                `Do NOT supplement with information not present in this block.`,
            },
          ]
        : []),
      ...history.slice(-8),
      { role: "user", content: userMessage },
    ];

    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        max_tokens: 800,
        temperature: 0.3,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      console.error("❌ [OpenAI] API error:", JSON.stringify(err));
      throw new Error(err?.error?.message ?? `OpenAI error ${res.status}`);
    }

    const json = await res.json();
    const raw = json.choices?.[0]?.message?.content ?? "{}";
    console.log("✅ [OpenAI] Response:", raw.slice(0, 300));
    const parsed = JSON.parse(raw);

    // Normalise data -- GPT sometimes returns interactions at top level
    let data = parsed.data ?? undefined;
    if (parsed.type === "medication" && !Array.isArray(data)) {
      data = Array.isArray(parsed.medications) ? parsed.medications : [];
    }
    if (parsed.type === "health" && !data && parsed.interactions) {
      data = { interactions: parsed.interactions };
    }
    if (
      parsed.type === "suggestion" &&
      !data &&
      Array.isArray(parsed.suggestions)
    ) {
      data = parsed.suggestions;
    }

    const text =
      typeof parsed.text === "string" && parsed.text.trim()
        ? parsed.text
        : data
          ? "Here is the information you requested."
          : "I couldn't generate a response. Please try again.";

    return { type: parsed.type ?? "text", text, data };
  } catch (err: any) {
    console.error("❌ [OpenAI] sendChatMessage failed:", err.message);
    return { type: "text", text: `Error: ${err.message}` };
  }
}

// ─── 10. Mark medication taken ────────────────────────────────────────────────

export async function markMedicationTaken(
  uid: string,
  medicationId: string,
): Promise<void> {
  try {
    await updateDoc(doc(db, "users", uid, "medications", medicationId), {
      taken: true,
    });
    console.log("✅ [Firebase] Marked taken:", medicationId);
  } catch (err: any) {
    console.error("❌ [Firebase] markMedicationTaken:", err.message);
  }
}

// =============================================================================
// REACTIONS ANALYSIS
// =============================================================================

export interface AISideEffect {
  medicationName: string;
  medicationId: string;
  summary: string;
  common: string[];
  serious: string[];
  profileWarnings: AIProfileWarning[];
}

export interface AIInteraction {
  drugA: string;
  drugB: string;
  severity: "mild" | "moderate" | "severe";
  severityReason: string;
  description: string;
  recommendation: string;
}

export interface AIProfileWarning {
  type: "pregnancy" | "breastfeeding" | "condition" | "age" | "general";
  warning: string;
  severity: "info" | "caution" | "danger";
}

export interface AICommunityReport {
  symptom: string;
  reportCount: number;
  avgSeverity: number;
  medications: string[];
  note: string;
}

export interface ReactionsAnalysis {
  sideEffects: AISideEffect[];
  interactions: AIInteraction[];
  profileWarnings: AIProfileWarning[];
  communityReports: AICommunityReport[];
  summary: string;
  lastUpdated: Date;
}

async function fetchCommunityLogs(
  userConditions: string[],
  currentUid: string,
): Promise<string> {
  if (!userConditions.length) return "";
  try {
    const usersSnap = await getDocs(collection(db, "users"));
    const counts: Record<string, { total: number; severitySum: number }> = {};
    for (const userDoc of usersSnap.docs) {
      if (userDoc.id === currentUid) continue;
      const data = userDoc.data();
      const conditions = (data?.medicalData?.conditions ?? []) as string[];
      const shared = conditions.filter((c) =>
        userConditions.some((uc) => uc.toLowerCase() === c.toLowerCase()),
      );
      if (!shared.length) continue;
      const logsSnap = await getDocs(
        collection(db, "users", userDoc.id, "symptom_logs"),
      );
      for (const logDoc of logsSnap.docs) {
        const log = logDoc.data();
        if (!log.symptom) continue;
        const key = log.symptom.toLowerCase().trim();
        if (!counts[key]) counts[key] = { total: 0, severitySum: 0 };
        counts[key].total++;
        counts[key].severitySum += log.severity ?? 1;
      }
    }
    const sorted = Object.entries(counts)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 10);
    if (!sorted.length) return "";
    return sorted
      .map(
        ([symptom, d]) =>
          `- "${symptom}": reported ${d.total} time(s), avg severity ${(d.severitySum / d.total).toFixed(1)}/5`,
      )
      .join("\n");
  } catch (err: any) {
    console.warn("[Community] fetchCommunityLogs:", err.message);
    return "";
  }
}

export async function generateReactionsAnalysis(
  uid: string,
  medications: MedDoc[],
): Promise<ReactionsAnalysis> {
  const activeMeds = medications.filter((m) => m.active !== false && m.drug_id);
  if (!activeMeds.length) {
    return {
      sideEffects: [],
      interactions: [],
      profileWarnings: [],
      communityReports: [],
      summary: "No medications with database records found.",
      lastUpdated: new Date(),
    };
  }

  const profile = await getUserProfile(uid);
  const userData = profile?.userData ?? {};
  const medicalData = profile?.medicalData ?? {};
  const name = userData.name ?? "Patient";
  const gender = userData.gender ?? "unknown";
  const dob = userData.dateOfBirth ?? "";
  const age = calculateAge(dob);
  const bloodType = medicalData.bloodType ?? "unknown";
  const height = medicalData.height ?? "unknown";
  const weight = medicalData.weight ?? "unknown";
  const conditions = (medicalData.conditions ?? []) as string[];
  const allergies = (medicalData.allergies ?? []) as string[];
  const isPregnant = (medicalData.isPregnant ?? false) as boolean;
  const isBreastfeeding = (medicalData.isBreastfeeding ?? false) as boolean;

  const [medContext, interactionContext, userLogsSnap, communityData] =
    await Promise.all([
      fetchMedicationContext(activeMeds),
      fetchInteractionContext(activeMeds),
      getDocs(collection(db, "users", uid, "symptom_logs")),
      fetchCommunityLogs(conditions, uid),
    ]);

  const userLogs =
    userLogsSnap.docs
      .slice(0, 20)
      .map((d) => {
        const l = d.data();
        return `- ${l.symptom} (severity ${l.severity}/5)${l.note ? `: ${l.note}` : ""}`;
      })
      .join("\n") || "None logged yet.";

  const medSummary = activeMeds
    .map((m) => {
      const parts = [m.name];
      if (m.dosage) parts.push(m.dosage);
      if (m.is_combination && m.ingredients?.length)
        parts.push(`-- combination of: ${m.ingredients.join(" + ")}`);
      const ids = m.drug_ids?.length
        ? m.drug_ids
        : m.drug_id
          ? [m.drug_id]
          : [];
      if (ids.length) parts.push(`[DrugBank IDs: ${ids.join(", ")}]`);
      return parts.join(" ");
    })
    .join("\n");

  // ✅ ADD THE MISSING OPENAI CALL HERE
  const systemPrompt = `You are a clinical medication analysis AI. Analyze the patient's medications and provide a comprehensive report.

PATIENT PROFILE:
Name: ${name}
Age: ${age} | Gender: ${gender}
Blood type: ${bloodType} | Height: ${height} cm | Weight: ${weight} kg
Conditions: ${conditions.join(", ") || "None"}
Allergies: ${allergies.join(", ") || "None"}
Pregnancy: ${isPregnant ? "Yes" : "No"}
Breastfeeding: ${isBreastfeeding ? "Yes" : "No"}

CURRENT MEDICATIONS:
${medSummary}

DATABASE INFORMATION:
${medContext || "No additional database info"}

KNOWN INTERACTIONS:
${interactionContext || "No interactions found"}

USER'S SYMPTOM LOGS:
${userLogs}

COMMUNITY REPORTS (similar conditions):
${communityData || "No community data available"}

Return ONLY valid JSON with this exact structure:
{
  "summary": "A concise overall summary of the patient's medication profile",
  "sideEffects": [
    {
      "medicationName": "name",
      "medicationId": "id",
      "summary": "brief summary",
      "common": ["side effect 1", "side effect 2"],
      "serious": ["serious effect 1"],
      "profileWarnings": []
    }
  ],
  "interactions": [
    {
      "drugA": "name",
      "drugB": "name",
      "severity": "mild|moderate|severe",
      "severityReason": "why this severity",
      "description": "detailed description",
      "recommendation": "what to do"
    }
  ],
  "profileWarnings": [
    {
      "type": "condition|pregnancy|breastfeeding|age|allergy",
      "warning": "warning message",
      "severity": "info|caution|danger"
    }
  ],
  "communityReports": [
    {
      "symptom": "symptom name",
      "reportCount": 0,
      "avgSeverity": 0,
      "medications": [],
      "note": ""
    }
  ]
}`;

  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "system", content: systemPrompt }],
        max_tokens: 2000,
        temperature: 0.3,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      console.error("❌ [Reactions] API error:", err);
      throw new Error(err?.error?.message ?? "OpenAI API error");
    }

    const json = await res.json();
    const raw = json.choices?.[0]?.message?.content ?? "{}";
    console.log("✅ [Reactions] Analysis generated");

    const analysis = JSON.parse(raw) as ReactionsAnalysis;

    // Cache the result
    await setDoc(doc(db, "users", uid, "reactions_cache", "latest"), {
      ...analysis,
      lastUpdated: new Date(),
    });

    return {
      ...analysis,
      lastUpdated: new Date(),
    };
  } catch (error: any) {
    console.error("❌ [Reactions] Error:", error.message);
    return {
      sideEffects: [],
      interactions: [],
      profileWarnings: [],
      communityReports: [],
      summary:
        "Unable to generate analysis at this time. Please try again later.",
      lastUpdated: new Date(),
    };
  }
}
