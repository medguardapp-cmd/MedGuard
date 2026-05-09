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

function soundex(word: string): string {
  const s = word.toUpperCase();
  if (!s.length) return "";
  const firstChar = s[0];
  const codes: string[] = [];
  const map: Record<string, string> = {
    BFPV: "1",
    CGJKQSXZ: "2",
    DT: "3",
    L: "4",
    MN: "5",
    R: "6",
  };
  for (let i = 1; i < s.length; i++) {
    let found = false;
    for (const [group, code] of Object.entries(map)) {
      if (group.includes(s[i])) {
        codes.push(code);
        found = true;
        break;
      }
    }
    if (!found) codes.push("0");
  }
  let result = firstChar;
  let lastCode = "";
  for (const code of codes) {
    if (code !== lastCode && code !== "0") {
      result += code;
      lastCode = code;
    }
    if (result.length === 4) break;
  }
  return result.padEnd(4, "0");
}

function enhancedFuzzyMatch(
  input: string,
  candidates: { name: string; canonical: string }[],
): string | null {
  const normalizedInput = input.toLowerCase().trim();

  const exact = candidates.find((c) => c.name === normalizedInput);
  if (exact) return exact.canonical;

  const contains = candidates.find(
    (c) => c.name.includes(normalizedInput) || normalizedInput.includes(c.name),
  );
  if (contains) return contains.canonical;

  let bestMatch: { candidate: string; dist: number; canonical: string } | null =
    null;
  const inputLen = normalizedInput.length;
  const maxDist = Math.max(2, Math.floor(inputLen / 2));

  for (const { name, canonical } of candidates) {
    const dist = levenshtein(normalizedInput, name);
    if (dist <= maxDist && (!bestMatch || dist < bestMatch.dist)) {
      bestMatch = { candidate: name, dist, canonical };
    }
  }

  if (bestMatch && bestMatch.dist <= maxDist) {
    console.log(
      `🔤 [Enhanced] "${input}" → "${bestMatch.canonical}" (dist ${bestMatch.dist})`,
    );
    return bestMatch.canonical;
  }

  const inputSoundex = soundex(normalizedInput);
  const phoneticMatches = candidates.filter(
    (c) => soundex(c.name) === inputSoundex,
  );
  if (phoneticMatches.length > 0) {
    const bestPhonetic = phoneticMatches.sort(
      (a, b) => a.name.length - b.name.length,
    )[0];
    console.log(
      `🔊 [Phonetic] "${input}" → "${bestPhonetic.canonical}" (Soundex: ${inputSoundex})`,
    );
    return bestPhonetic.canonical;
  }

  return null;
}

function fuzzyCorrectDrugName(input: string): string {
  if (!knownDrugNames.length) return input;

  const words = input.split(/\s+/);
  if (words.length > 1) {
    const fullMatch = enhancedFuzzyMatch(input, knownDrugNames);
    if (fullMatch) return fullMatch;

    const correctedWords = words.map((word) => {
      const match = enhancedFuzzyMatch(word, knownDrugNames);
      return match || word;
    });
    return correctedWords.join(" ");
  }

  const match = enhancedFuzzyMatch(input, knownDrugNames);
  return match || input;
}

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

async function classifyInputAI(
  message: string,
): Promise<"health" | "off-topic" | "gibberish"> {
  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: 10,
        messages: [
          {
            role: "system",
            content: `
You classify user messages for a medication app.

Return ONLY one word:

health      = medications, symptoms, wellness, hospitals, brands, generic names, side effects, dosage, supplements
off-topic   = unrelated topics like coding, sports, finance, movies, travel
gibberish   = nonsense, unreadable, random letters

Examples:
"What brands of paracetamol?" -> health
"Can I take Biogesic?" -> health
"bitcoin price" -> off-topic
"who won nba" -> off-topic
"asdjkhqwe" -> gibberish
            `,
          },
          { role: "user", content: message },
        ],
      }),
    });

    if (!res.ok) return "health";
    const json = await res.json();
    const raw =
      json.choices?.[0]?.message?.content?.trim().toLowerCase() || "health";
    if (raw.includes("gibberish")) return "gibberish";
    if (raw.includes("off-topic")) return "off-topic";
    return "health";
  } catch {
    return "health";
  }
}

// ─── Helper: fetch drugs by DrugBank IDs ─────────────────────────────────────

async function fetchDrugsByIds(drugIds: string[]): Promise<any[]> {
  if (!drugIds.length) return [];
  const { data, error } = await supabase
    .from("drugs")
    .select(
      "id, name, indication, mechanism_of_action, toxicity, class, subclass",
    )
    .in("id", drugIds);
  if (error) console.warn("⚠️ [Supabase] fetchDrugsByIds:", error.message);
  return data ?? [];
}

// ─── Helper: format one drug entry for GPT context ───────────────────────────
// NOTE: Only passes fields a patient actually needs. Raw clinical dumps
// (mechanism_of_action, absorption, half_life, metabolism) are excluded here
// so GPT doesn't regurgitate them verbatim as a wall of text.

function formatDrug(drug: any, mapping: any | null, label = "DRUG"): string {
  const brands = mapping?.ph_brand ?? "N/A";
  const genericName = mapping?.generic_name ?? drug?.name ?? "N/A";
  const isCombo = mapping?.is_combination ?? false;
  const ingredients = mapping?.ingredients?.join(" + ") ?? "N/A";
  return `${label}: ${drug?.name ?? genericName}
  PH brand(s): ${brands}
  PH generic name: ${genericName}
  Combination drug: ${isCombo ? `Yes (${ingredients})` : "No"}
  Drug class: ${drug?.class ?? "N/A"}
  What it's used for: ${drug?.indication ?? "N/A"}
  Side effects / warnings: ${drug?.toxicity ?? "N/A"}`;
}

// ─── 1. NLP drug name extraction with fuzzy correction ───────────────────────

async function extractDrugNamesFromMessage(message: string): Promise<string[]> {
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

    const corrected = rawDrugs.map(fuzzyCorrectDrugName);
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
      .limit(1);
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
          return `  INGREDIENT ${drug.name}:\n    Used for: ${drug.indication ?? "N/A"}\n    Side effects: ${drug.toxicity ?? "N/A"}`;
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

// ─── ADD THIS HELPER (copy from your index.tsx) ──────────────────────────────

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function isReminderActiveOnDate(
  reminder: any,
  date: Date,
  medication?: any,
): boolean {
  if (!reminder.enabled) return false;

  const normalizedDate = new Date(date);
  normalizedDate.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // ✅ Handle until-empty
  if (reminder.durationType === "until-empty") {
    if (
      !medication ||
      medication.quantity === undefined ||
      medication.quantity <= 0
    ) {
      return false;
    }

    const createdDate = reminder.createdAt?.toDate
      ? new Date(reminder.createdAt.toDate())
      : new Date();
    createdDate.setHours(0, 0, 0, 0);

    if (normalizedDate <= today) {
      const daysSinceCreation = Math.floor(
        (normalizedDate.getTime() - createdDate.getTime()) /
          (1000 * 60 * 60 * 24),
      );
      const totalDays = daysSinceCreation + medication.quantity;
      return daysSinceCreation < totalDays;
    } else {
      const daysFromToday = Math.floor(
        (normalizedDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
      );
      return daysFromToday < medication.quantity;
    }
  }

  // Handle one-time reminders (no days array)
  if (!reminder.days || reminder.days.length === 0) {
    if (reminder.scheduledDate) {
      const scheduledDate = new Date(reminder.scheduledDate);
      scheduledDate.setHours(0, 0, 0, 0);
      return normalizedDate.getTime() === scheduledDate.getTime();
    }

    // Fallback to creation date
    const createdDate = reminder.createdAt?.toDate
      ? reminder.createdAt.toDate()
      : new Date(reminder.createdAt);

    const firstTime =
      reminder.times && reminder.times.length > 0 ? reminder.times[0] : "08:00";
    const [hours, minutes] = firstTime.split(":").map(Number);

    const reminderDateTime = new Date(createdDate);
    reminderDateTime.setHours(hours, minutes, 0, 0);

    if (reminderDateTime <= createdDate) {
      reminderDateTime.setDate(reminderDateTime.getDate() + 1);
    }

    const scheduledDate = new Date(reminderDateTime);
    scheduledDate.setHours(0, 0, 0, 0);
    return normalizedDate.getTime() === scheduledDate.getTime();
  }

  // For recurring reminders with days
  const dayName = DAY_NAMES[normalizedDate.getDay()];
  if (!reminder.days.includes(dayName)) return false;

  if (reminder.createdAt) {
    const createdDate = reminder.createdAt?.toDate
      ? new Date(reminder.createdAt.toDate())
      : new Date(reminder.createdAt);
    createdDate.setHours(0, 0, 0, 0);
    if (normalizedDate < createdDate) return false;
  }

  if (reminder.durationType === "date-range") {
    if (reminder.startDate) {
      const startDate = new Date(reminder.startDate);
      startDate.setHours(0, 0, 0, 0);
      if (normalizedDate < startDate) return false;
    }
    if (reminder.endDate) {
      const endDate = new Date(reminder.endDate);
      endDate.setHours(0, 0, 0, 0);
      if (normalizedDate > endDate) return false;
    }
  }

  return true;
}

// ─── 7. Build system prompt (FIXED) ─────────────────────────────────────────

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
  const allMeds = profile?.medications ?? [];

  const today = new Date();
  const todayKey = today.toDateString();
  const todayDate = today.toLocaleDateString("en-PH", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const [remindersSnap, takenSnap, reactionsCacheSnap] = await Promise.all([
    getDocs(collection(db, "users", uid, "reminders")),
    getDocs(
      query(
        collection(db, "users", uid, "taken_logs"),
        where("dateKey", "==", todayKey),
      ),
    ),
    getDoc(doc(db, "users", uid, "reactions_cache", "latest")),
  ]);

  const allReminders = remindersSnap.docs.map(
    (d) =>
      ({
        id: d.id,
        ...d.data(),
      }) as any,
  );

  // ✅ Use the SAME isReminderActiveOnDate function as index.tsx
  const todayReminders = allReminders.filter((r: any) => {
    const medication = allMeds.find((m) => m.id === r.medicationId);
    return isReminderActiveOnDate(r, today, medication);
  });

  // Get medication IDs that are active today
  const todayMedicationIds = new Set(
    todayReminders.map((r: any) => r.medicationId),
  );

  // ✅ Filter to ONLY medications that have reminders today
  const todayMeds = allMeds.filter((m) => todayMedicationIds.has(m.id));

  console.log("📅 Today's reminders:", todayReminders.length);
  console.log(
    "💊 Today's medications:",
    todayMeds.map((m) => m.name),
  );

  // Fetch contexts with TODAY'S medications only
  const [medContext, interactionContext] = await Promise.all([
    fetchMedicationContext(todayMeds),
    fetchInteractionContext(todayMeds),
  ]);

  const scheduledLines = todayReminders.length
    ? todayReminders.map(
        (r: any) =>
          `  - ${r.medicationName} ${r.medicationDosage} at ${r.time || r.times?.[0] || "08:00"}`,
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
      `  - ${r.medicationName} ${r.medicationDosage} (scheduled ${r.time || r.times?.[0] || "08:00"})`,
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

  const medSummary = todayMeds.map((m) => {
    const parts = [m.name];
    if (m.dosage) parts.push(m.dosage);
    if (m.is_combination && m.ingredients?.length)
      parts.push(`(${m.ingredients.join(" + ")})`);
    return parts.join(" ");
  });

  return `You are MEADGUARD, a friendly but professional medication assistant in a mobile health app.
You help patients understand their medicines in simple, clear language.

════════════════════════════════════════════════════
RESPONSE STYLE — READ THIS FIRST, ALWAYS FOLLOW
════════════════════════════════════════════════════
You are talking to a regular patient on their phone, NOT a medical professional.

TONE & LENGTH:
- Write like a knowledgeable friend, not a textbook.
- Keep responses SHORT and conversational. 2-4 sentences for simple questions.
- Use plain Filipino/English that anyone can understand.
- Never use technical jargon (mechanism of action, pharmacodynamics, half-life, etc.)
  unless the patient specifically asks for it.

WHAT TO INCLUDE (pick only what's relevant to the question):
- What the medicine is used for (1 sentence)
- Common side effects IF asked or if there's a safety concern (2-3 max, plain words)
- Any interaction with the patient's current medications (only if there is one)
- A brief safety note if needed

WHAT TO NEVER INCLUDE UNLESS ASKED:
- Mechanism of action
- Pharmacodynamics / pharmacokinetics
- Absorption, half-life, metabolism
- DrugBank IDs or technical database fields
- Long lists of every possible side effect
- The full patient profile repeated back

FORMATTING:
- Use short paragraphs, not walls of text.
- Bullet points only when listing 3+ items (e.g. multiple side effects).
- Maximum 5 bullet points per response.
- If you want to mention a brand name, just say it naturally in a sentence.

TYPOS: If the patient misspells a drug name (e.g. "bigesic", "parcetamol"),
silently use the correct name in your response. Do NOT say "did you mean" or
comment on the spelling at all — just answer about the correct drug naturally.
════════════════════════════════════════════════════

DATABASE-FIRST RULES
════════════════════════════════════════════════════
1. ALL drug facts MUST come from the database context in this prompt.
2. NEVER invent drug names, side effects, dosages, or interactions.
   If the drug isn't in the database, say: "I don't have info on that medicine.
   Please check with your pharmacist."
3. Use database facts but translate them into plain language for the patient.
4. You support multi-turn conversation. If asked to simplify or shorten,
   rewrite your previous answer accordingly.
════════════════════════════════════════════════════

PATIENT PROFILE
Name: ${name}
Age: ${age} | Gender: ${gender} | Date of birth: ${dob}
Blood type: ${bloodType} | Height: ${height} cm | Weight: ${weight} kg
Active medications TODAY: ${medSummary.length ? medSummary.join("; ") : "None scheduled for today"}
Allergies: ${allergies.length ? allergies.join(", ") : "None recorded"}
Medical conditions: ${conditions.length ? conditions.join(", ") : "None recorded"}
${notes ? `Clinical notes: ${notes}` : ""}

TODAY'S SCHEDULE (${todayDate})
=========================================
Scheduled today (${todayReminders.length} reminder${todayReminders.length !== 1 ? "s" : ""}):
${scheduledLines.join("\n")}

Already taken today:
${takenLines.join("\n")}

Missed — scheduled but not yet taken (${missedReminders.length}):
${missedReminders.length ? missedLines.join("\n") : "  None — all caught up!"}
=========================================

⚠️ CRITICAL RULES:
- "Today's medications" = ONLY the ${todayReminders.length} item(s) above.
- When asked about "today's meds" or "my medications", ONLY mention the ones 
  scheduled today (${todayMeds.map((m) => m.name).join(", ") || "none"}).
- DO NOT mention medications that are not in today's schedule.
- If there are no medications scheduled today, say so clearly.

MEDICATION DATABASE (TODAY'S medications only)
${medContext || "No medications scheduled for today."}

KNOWN INTERACTIONS BETWEEN TODAY'S MEDICATIONS
${interactionContext || "No interactions found between today's medications."}

AI REACTIONS ANALYSIS:
${reactionsContext || "No reactions analysis available yet."}

SCOPE:
- Answer anything about medications, health, symptoms, drug interactions, wellness.
- For off-topic questions (weather, sports, finance), politely say you only handle health topics.
- For gibberish, ask the patient to rephrase their health question.

RESPONSE FORMAT — Respond ONLY with valid JSON:
{
  "type": "text" | "medication" | "health" | "suggestion",
  "text": "Your friendly, plain-language response here (ALWAYS non-empty)",
  "data": <only include if needed, see shapes below>
}

data shapes:
- "medication" -> [{ "name": string, "dosage": string, "time": string, "taken": boolean, "note": string }]
  Return EXACTLY the ${todayReminders.length} scheduled item(s). No extras.
- "health" (interactions) -> { "interactions": [{ "meds": ["DrugA","DrugB"], "severity": "moderate", "advice": "plain language advice" }] }
- "health" (metrics) -> [{ "type": string, "value": string, "unit": string, "trend": "up"|"down"|"stable" }]
- "suggestion" -> string[] (plain language tips, max 4 items)
- "text" -> null`;
}

// ─── 8. Preload ───────────────────────────────────────────────────────────────

export async function preloadUserContext(uid: string): Promise<void> {
  if (!uid || cachedUid === uid) return;
  console.log("🔵 [OpenAI] Preloading context for uid:", uid);
  try {
    await Promise.all([getUserProfile(uid), ensureDrugNamesCache()]);
    cachedUid = uid;
    console.log("✅ [OpenAI] Context preloaded -- chat ready");
  } catch (err: any) {
    console.warn("⚠️ [OpenAI] Preload failed:", err.message);
    cachedUid = uid;
  }
}

// Quick brand lookup for common patterns like "brand of biogesic"
async function quickBrandLookup(
  userMessage: string,
): Promise<AIResponse | null> {
  const brandPatterns = [
    /brands? of (\w+)/i,
    /(\w+) brands?/i,
    /what brands? (?:is|are|for) (\w+)/i,
    /anong brand (?:ng|ang) (\w+)/i,
    /available brands? of (\w+)/i,
    /(\w+) available brands?/i,
    /(?:meron bang|may) brand (?:ng|na) (\w+)/i,
  ];

  let drugName: string | null = null;
  for (const pattern of brandPatterns) {
    const match = userMessage.match(pattern);
    if (match) {
      drugName = match[1];
      break;
    }
  }

  if (!drugName) return null;

  await ensureDrugNamesCache();
  const correctedDrug = fuzzyCorrectDrugName(drugName);
  const searchTerms =
    correctedDrug !== drugName ? [correctedDrug, drugName] : [drugName];

  for (const term of searchTerms) {
    const { data, error } = await supabase
      .from("ph_medicine_mapping")
      .select("ph_brand, generic_name")
      .or(`ph_brand.ilike.%${term}%,generic_name.ilike.%${term}%`)
      .limit(30);

    if (!error && data && data.length > 0) {
      const brands = [
        ...new Set(data.map((row) => row.ph_brand).filter(Boolean)),
      ];
      const genericNames = [
        ...new Set(data.map((row) => row.generic_name).filter(Boolean)),
      ];

      if (brands.length > 0) {
        return {
          type: "text",
          text: `${genericNames[0] || term} is available in the Philippines under these brands: ${brands.join(", ")}. Check with your pharmacy for what's available near you.`,
        };
      }
    }
  }

  return null;
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
    // ── Step 0: Fast guard ──────────────────────────────────────────────────
    const inputClass = await classifyInputAI(userMessage);

    if (inputClass === "gibberish") {
      return {
        type: "text",
        text: "I'm not sure I understood that. Could you rephrase your question? I'm here to help with your medications and health. 😊",
      };
    }
    if (inputClass === "off-topic") {
      return {
        type: "text",
        text: "I'm mainly here for medication and health questions—but feel free to ask anything related to medicines, like brands, uses, or side effects. 😊",
      };
    }

    // ── Step 0.5: Quick brand lookup (no GPT needed) ────────────────────────
    const brandResponse = await quickBrandLookup(userMessage);
    if (brandResponse) return brandResponse;

    // ── Step 1: Build prompt + NLP extraction in parallel ──────────────────
    const [freshPrompt, extractedDrugs] = await Promise.all([
      buildSystemPrompt(uid).catch(() => FALLBACK_PROMPT),
      extractDrugNamesFromMessage(userMessage),
    ]);

    // ── BRAND QUERY SHORTCUT ───────────────────────────────────────────────
    if (
      extractedDrugs.length &&
      /(brand|brands|available|what brand|anong brand)/i.test(userMessage)
    ) {
      const drug = extractedDrugs[0];
      const correctedDrug = fuzzyCorrectDrugName(drug);

      const { data, error } = await supabase
        .from("ph_medicine_mapping")
        .select("ph_brand,generic_name")
        .ilike("generic_name", `%${correctedDrug}%`)
        .limit(20);

      if (!error && data?.length) {
        const brands = [
          ...new Set(data.map((row) => row.ph_brand).filter(Boolean)),
        ];
        if (brands.length > 0) {
          return {
            type: "text",
            text: `${correctedDrug} is available under these brands: ${brands.join(", ")}.`,
          };
        }
      }

      return {
        type: "text",
        text: `I couldn't find "${drug}" in my database. Try the generic name or double-check the spelling.`,
      };
    }

    // ── Step 2: Get patient drug IDs ────────────────────────────────────────
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

    // ── Step 4: Build messages ──────────────────────────────────────────────
    const messages: ChatMessage[] = [
      { role: "system", content: freshPrompt },
      ...(liveContext
        ? [
            {
              role: "system" as const,
              content:
                `ADDITIONAL DRUG INFORMATION FROM DATABASE:\n\n` +
                `${liveContext}\n\n` +
                `IMPORTANT: Use this data as your source of truth. ` +
                `Translate the clinical facts above into simple, friendly language the patient can understand. ` +
                `Do NOT copy technical field names or dump raw text. ` +
                `Answer only what the patient asked — don't volunteer all fields at once.`,
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
        max_tokens: 500, // reduced from 800 — forces concise responses
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

    await setDoc(doc(db, "users", uid, "reactions_cache", "latest"), {
      ...analysis,
      lastUpdated: new Date(),
    });

    return { ...analysis, lastUpdated: new Date() };
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
