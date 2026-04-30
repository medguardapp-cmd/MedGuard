import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://gbqotywkxwlcafvdimwi.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdicW90eXdreHdsY2FmdmRpbXdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MTM4NTIsImV4cCI6MjA4ODk4OTg1Mn0.sx6vtVPau7nW0wZNzwWP3QTzjv3pkRczED9SivtzVrI";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// ─────────────────────────────────────────────
// Search result type
// is_generic flag distinguishes brand vs generic entries
// in the suggestions list
// ─────────────────────────────────────────────
export interface MedicineSearchResult {
  id: string; // unique key for FlatList
  ph_brand: string; // display name (brand name OR generic name)
  generic_name: string; // always the generic name
  drug_id: string;
  drug_ids: string[];
  ingredients: string[];
  is_combination: boolean;
  is_generic: boolean; // true = generic entry, false = brand entry
}

// ─────────────────────────────────────────────
// Drug search
//
// Returns a unified list of brand + generic entries.
// For each unique drug matched, we add:
//   - One entry per brand name  (is_generic: false)
//   - One entry per unique generic name (is_generic: true)
//
// Example — searching "Amoxicillin":
//   AMOXIL          [Brand]
//   TRIMOX          [Brand]
//   AUGMENTIN       [Brand]  ← combo with clavulanic
//   Amoxicillin     [Generic]
//   Amoxicillin + Clavulanic Acid  [Generic]
// ─────────────────────────────────────────────
export async function searchMedicines(
  query: string,
): Promise<MedicineSearchResult[]> {
  if (!query || query.length < 2) return [];

  // Search 1: match ph_brand or generic_name directly in ph_medicine_mapping
  const { data: brandResults, error: brandError } = await supabase
    .from("ph_medicine_mapping")
    .select(
      "id, ph_brand, generic_name, drug_id, drug_ids, ingredients, is_combination",
    )
    .or(`ph_brand.ilike.%${query}%,generic_name.ilike.%${query}%`)
    .limit(20);

  if (brandError) console.error("Brand search error:", brandError.message);

  // Search 2: match drug name in the drugs table
  const { data: drugResults, error: drugError } = await supabase
    .from("drugs")
    .select("id, name")
    .ilike("name", `%${query}%`)
    .limit(20);

  if (drugError) console.error("Drug name search error:", drugError.message);

  // Search 3: find all PH brands linked to the matched drug IDs
  let ingredientResults: any[] = [];
  if (drugResults && drugResults.length > 0) {
    const matchedIds = drugResults.map((d) => d.id);
    const { data, error } = await supabase
      .from("ph_medicine_mapping")
      .select(
        "id, ph_brand, generic_name, drug_id, drug_ids, ingredients, is_combination",
      )
      .in("drug_id", matchedIds)
      .limit(20);

    if (error) console.error("Ingredient search error:", error.message);
    ingredientResults = data || [];
  }

  // Merge all raw results and deduplicate by mapping id
  const allRaw = [...(brandResults || []), ...ingredientResults];
  const seenIds = new Set();
  const dedupedRaw = allRaw.filter((item) => {
    if (seenIds.has(item.id)) return false;
    seenIds.add(item.id);
    return true;
  });

  // Build final list:
  // - One Brand entry per row (using ph_brand as display name)
  // - One Generic entry per unique generic_name found
  const brandEntries: MedicineSearchResult[] = dedupedRaw.map((item) => ({
    id: `brand-${item.id}`,
    ph_brand: item.ph_brand,
    generic_name: item.generic_name,
    drug_id: item.drug_id,
    drug_ids: item.drug_ids || [],
    ingredients: item.ingredients || [],
    is_combination: item.is_combination || false,
    is_generic: false,
  }));

  // Collect unique generic names and build generic entries
  const seenGenerics = new Set<string>();
  const genericEntries: MedicineSearchResult[] = [];

  for (const item of dedupedRaw) {
    const key = `${item.drug_id}-${item.generic_name}`;
    if (!seenGenerics.has(key)) {
      seenGenerics.add(key);
      genericEntries.push({
        id: `generic-${item.drug_id}-${item.id}`,
        ph_brand: item.generic_name, // display the generic name as the title
        generic_name: item.generic_name,
        drug_id: item.drug_id,
        drug_ids: item.drug_ids || [],
        ingredients: item.ingredients || [],
        is_combination: item.is_combination || false,
        is_generic: true,
      });
    }
  }

  // Return brands first, then generics
  return [...brandEntries, ...genericEntries];
}

// ─────────────────────────────────────────────
// Fetch full drug details from Supabase by DrugBank ID
// ─────────────────────────────────────────────
export async function getDrugById(drugId: string) {
  const { data, error } = await supabase
    .from("drugs")
    .select("*")
    .eq("id", drugId)
    .single();

  if (error) {
    console.error("Get drug error:", error.message);
    return null;
  }

  return data;
}

// ─────────────────────────────────────────────
// Check interaction between two specific drugs
// ─────────────────────────────────────────────
export async function checkInteraction(drugIdA: string, drugIdB: string) {
  const { data, error } = await supabase
    .from("drug_interactions")
    .select("*")
    .eq("drug_id", drugIdA)
    .eq("interacts_with", drugIdB)
    .single();

  if (error) return null;
  return data;
}

// ─────────────────────────────────────────────
// Check interactions for a new drug against all current meds
// ─────────────────────────────────────────────
export async function checkAllInteractions(
  newDrugId: string,
  existingDrugIds: string[],
) {
  if (!existingDrugIds.length) return [];

  const { data, error } = await supabase
    .from("drug_interactions")
    .select("*")
    .eq("drug_id", newDrugId)
    .in("interacts_with", existingDrugIds);

  if (error) {
    console.error("Interaction check error:", error.message);
    return [];
  }

  return data || [];
}
