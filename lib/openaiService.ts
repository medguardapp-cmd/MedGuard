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
//   1. NLP pre-call  — GPT extracts drug names from the user message
//   2. Mapping lookup — ph_medicine_mapping → get ingredients + drug_ids
//   3. Supabase drugs — fetch full clinical data using drug_ids
//   4. Supabase interactions — check drug_ids against patient's current meds
//   5. GPT main call — answers using only DB data + patient profile

import {
    collection,
    doc,
    getDoc,
    getDocs,
    updateDoc,
} from "firebase/firestore";
import { db } from "./firebase";
import { supabase } from "./supabase";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY!;
const MODEL = "gpt-4o-mini";

let cachedSystemPrompt: string | null = null;
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

// ─── Helper: fetch drugs by DrugBank IDs ──────────────────────────────────────
// Centralised so every lookup uses the exact same confirmed columns

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
  Combination: ${isCombo ? `Yes — ingredients: ${ingredients}` : "No"}
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
// Fast GPT call — extracts drug names only, handles any language or brand name

async function extractDrugNamesFromMessage(message: string): Promise<string[]> {
  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 60,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You are a drug name extractor. Extract any medication, drug, vitamin, or supplement names from the user message.
Return ONLY valid JSON: { "drugs": ["name1", "name2"] }
If no drug names found, return: { "drugs": [] }
Rules:
- Include brand names (Biogesic, Medicol, Diane 35) AND generic names (paracetamol, ibuprofen)
- Include vitamins and supplements (Vitamin C, iron, folic acid)
- Do NOT include drug classes (antibiotic, painkiller) — only specific names
- Keep names exactly as the user wrote them`,
          },
          { role: "user", content: message },
        ],
      }),
    });

    if (!res.ok) return [];
    const json = await res.json();
    const raw = json.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);
    const drugs: string[] = parsed.drugs ?? [];
    console.log(
      `🧠 [NLP] Extracted: ${drugs.length ? drugs.join(", ") : "none"}`,
    );
    return drugs;
  } catch (err: any) {
    console.warn("⚠️ [NLP] Extraction failed:", err.message);
    return [];
  }
}

// ─── 2. Look up a drug by name — uses ingredients for clinical data ───────────
//
// Steps:
//   A. Search ph_medicine_mapping by ph_brand OR generic_name
//   B. Use drug_ids[] (ingredient DrugBank IDs) to fetch from drugs table
//   C. Use drug_ids[] to check interactions against patient's current meds
//
// This ensures Biogesic → Acetaminophen (DrugBank) for correct side effects

async function lookupDrugByName(
  query: string,
  patientDrugIds: string[] = [],
): Promise<string> {
  if (!query || query.length < 2) return "";
  console.log(`🔵 [Supabase] Looking up: "${query}"`);

  try {
    // Step A: search mapping by brand OR generic name
    const { data: mappings, error: mapErr } = await supabase
      .from("ph_medicine_mapping")
      .select(
        "id, drug_id, ph_brand, generic_name, drug_ids, ingredients, is_combination",
      )
      .or(`ph_brand.ilike.%${query}%,generic_name.ilike.%${query}%`)
      .limit(5);

    if (mapErr) console.warn("⚠️ [Supabase] mapping:", mapErr.message);

    // Step B: resolve all DrugBank IDs via drug_ids[] (covers ingredient name changes)
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
      // Fallback: search drugs table directly (handles DrugBank-only names)
      console.log(
        `🔵 [Supabase] No mapping — searching drugs table: "${query}"`,
      );
      const { data: byName } = await supabase
        .from("drugs")
        .select("id, name")
        .ilike("name", `%${query}%`)
        .limit(3);

      if (!byName?.length) {
        console.log(`ℹ️ [Supabase] No DB results for: "${query}"`);
        return "";
      }
      allIngredientIds = byName.map((d) => d.id);
    }

    // Step B: fetch full clinical data using ingredient IDs
    const drugs = await fetchDrugsByIds(allIngredientIds);

    // Step C: check interactions between this drug's ingredients and patient's meds
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

    if (!mappings?.length && drugs.length) {
      return drugs.map((d) => formatDrug(d, null, "DRUG INFO")).join("\n\n");
    }

    console.log(
      `✅ [Supabase] Found ${mappings!.length} mapping(s) for "${query}"`,
    );

    // Deduplicate by generic_name and format output
    const seen = new Set<string>();
    return (mappings ?? [])
      .filter((m) => {
        const key = m.generic_name ?? m.ph_brand;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((m) => {
        // Match by first ingredient ID (drug_ids[0] or drug_id)
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

// ─── 3. Fetch live context for all NLP-extracted drug names ──────────────────

async function fetchLiveContext(
  drugNames: string[],
  patientDrugIds: string[],
): Promise<string> {
  if (!drugNames.length) return "";
  const results = await Promise.all(
    drugNames.map((name) => lookupDrugByName(name, patientDrugIds)),
  );
  const found = results.filter(Boolean);
  if (found.length) {
    console.log(
      `✅ [Supabase] Live context ready for: ${drugNames.join(", ")}`,
    );
  }
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

// ─── 5. Fetch drug context for patient's current medications ──────────────────
// Uses drug_ids[] from each medication doc (ingredient IDs) for accurate data

async function fetchMedicationContext(meds: MedDoc[]): Promise<string> {
  if (!meds.length) return "";

  // Collect all ingredient IDs across all meds
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

  // Fetch mappings and full drug details in parallel
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

      // For combination drugs, list each ingredient separately
      const ingredientDetails = medDrugIds
        .map((id) => {
          const drug = drugs.find((d) => d.id === id);
          if (!drug) return null;
          return `  INGREDIENT ${drug.name}:
    Indication: ${drug.indication ?? "N/A"}
    Side effects: ${drug.toxicity ?? "N/A"}
    Half-life: ${drug.half_life ?? "N/A"}
    Mechanism: ${drug.mechanism_of_action ?? "N/A"}`;
        })
        .filter(Boolean)
        .join("\n");

      const isCombo = med.is_combination ?? false;
      const ingredients = med.ingredients?.join(" + ") ?? "N/A";

      return `CURRENT MED: ${med.name}
  PH brand: ${mapping?.ph_brand ?? "N/A"}
  Dosage prescribed: ${med.dosage ?? "N/A"}
  Combination: ${isCombo ? `Yes — ${ingredients}` : "No"}
  DrugBank IDs: ${medDrugIds.join(", ")}
${ingredientDetails}`;
    })
    .join("\n\n");
}

// ─── 6. Fetch known interactions between patient's current meds ───────────────
// Uses all ingredient IDs so combination drugs are fully checked

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

  const [medContext, interactionContext] = await Promise.all([
    fetchMedicationContext(meds),
    fetchInteractionContext(meds),
  ]);

  return `You are MEADGUARD, a professional clinical medication assistant in a mobile health app.
You have access to the patient's medical profile and a verified Philippine (PH) medication database.
IMPORTANT: Only use drug information provided in the context. Never invent or assume drug data.

PATIENT PROFILE
Name: ${name}
Age: ${age} | Gender: ${gender} | Date of birth: ${dob}
Blood type: ${bloodType} | Height: ${height} cm | Weight: ${weight} kg
Current medications: ${medSummary.length ? medSummary.join("; ") : "None recorded"}
Allergies: ${allergies.length ? allergies.join(", ") : "None recorded"}
Medical conditions: ${conditions.length ? conditions.join(", ") : "None recorded"}
${notes ? `Clinical notes: ${notes}` : ""}

MEDICATION DATABASE (patient's current drugs with ingredient breakdown)
${medContext || "No database records found for current medications."}

KNOWN INTERACTIONS BETWEEN CURRENT MEDICATIONS
${interactionContext || "No interactions found between current medications."}

CLINICAL INSTRUCTIONS
- Always personalise answers to ${name}: ${age}-year-old ${gender}.
- Conditions: ${conditions.join(", ") || "none"} — factor into every answer.
- Allergies: ${allergies.join(", ") || "none"} — flag conflicts immediately.
- Weight ${weight} kg, height ${height} cm — use for dosage context.
- When ADDITIONAL DRUG INFORMATION is provided below, use it to answer. That data is from the verified database.
- For side effects and interactions, always refer to the ingredient-level data (DrugBank names), not just the brand name.
- If a drug is asked about but no database data is in context, say: "I don't have that drug in the database. Please consult your pharmacist."
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
  "text": "Your main response — always a non-empty string",
  "data": <optional — omit if not needed>
}

data shapes:
- "medication"  -> [{ "name": string, "dosage": string, "time": string, "taken": boolean, "note": string }]
- "health" (interactions) -> { "interactions": [{ "meds": string[], "severity": "mild"|"moderate"|"severe", "advice": string }] }
- "health" (metrics)      -> [{ "type": string, "value": string, "unit": string, "trend": "up"|"down"|"stable" }]
- "suggestion"  -> string[]
- "text"        -> null`;
}

// ─── 8. Preload ───────────────────────────────────────────────────────────────

export async function preloadUserContext(uid: string): Promise<void> {
  if (!uid || cachedUid === uid) return;
  console.log("🔵 [OpenAI] Preloading context for uid:", uid);
  try {
    const prompt = await Promise.race([
      buildSystemPrompt(uid),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("Preload timeout after 8s")), 8000),
      ),
    ]);
    cachedSystemPrompt = prompt as string;
    cachedUid = uid;
    console.log("✅ [OpenAI] Context preloaded — chat ready");
  } catch (err: any) {
    console.warn(
      "⚠️ [OpenAI] Preload failed:",
      err.message,
      "— using fallback",
    );
    cachedSystemPrompt = FALLBACK_PROMPT;
    cachedUid = uid;
  }
}

export function invalidateCache(): void {
  cachedSystemPrompt = null;
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
    if (!cachedSystemPrompt || cachedUid !== uid) {
      console.log("🔵 [OpenAI] Cache miss — building prompt");
      await preloadUserContext(uid);
    } else {
      console.log("⚡ [OpenAI] Using cached prompt");
    }

    // Get patient's current drug IDs for interaction checking
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

    // Step 1: NLP — extract drug names from message
    // Step 2: Supabase — fetch real DB data + check interactions with patient meds
    const extractedDrugs = await extractDrugNamesFromMessage(userMessage);
    const liveContext = await fetchLiveContext(extractedDrugs, patientDrugIds);

    const messages: ChatMessage[] = [
      { role: "system", content: cachedSystemPrompt! },
      ...(liveContext
        ? [
            {
              role: "system" as const,
              content:
                `ADDITIONAL DRUG INFORMATION FROM DATABASE (source: Supabase — verified):\n\n${liveContext}\n\n` +
                `Use this data to answer the patient's question. ` +
                `Side effects and interactions are based on the ingredient-level DrugBank data above.`,
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

    const text =
      typeof parsed.text === "string" && parsed.text.trim()
        ? parsed.text
        : parsed.data
          ? "Here is the information you requested."
          : "I couldn't generate a response. Please try again.";

    return {
      type: parsed.type ?? "text",
      text,
      data: parsed.data ?? undefined,
    };
  } catch (err: any) {
    console.error("❌ [OpenAI] sendChatMessage failed:", err.message);
    return {
      type: "text",
      text: `Error: ${err.message}`,
    };
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
