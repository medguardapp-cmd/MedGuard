const XLSX = require("xlsx");
const { createClient } = require("@supabase/supabase-js");

// ─────────────────────────────────────────────
// Supabase Init
// ─────────────────────────────────────────────
const SUPABASE_URL = "https://gbqotywkxwlcafvdimwi.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdicW90eXdreHdsY2FmdmRpbXdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MTM4NTIsImV4cCI6MjA4ODk4OTg1Mn0.sx6vtVPau7nW0wZNzwWP3QTzjv3pkRczED9SivtzVrI";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─────────────────────────────────────────────
// Read Excel File
// ─────────────────────────────────────────────
function readExcel(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet);
}

// ─────────────────────────────────────────────
// Normalize drug name for matching
// Handles cases like:
//   "Acetylsalicylic Acid" → "acetylsalicylic acid"
//   "Abiraterone" → "abiraterone"
// ─────────────────────────────────────────────
function normalizeName(name) {
  return name?.toLowerCase().trim() || "";
}

// ─────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────
async function main() {
  console.log("=".repeat(80));
  console.log("PH Brand-Generic Mapping → Supabase Upload");
  console.log("=".repeat(80));

  // 1. Read Excel
  console.log("\n📖 Reading brand-generic.xlsx...");
  const rows = readExcel("brand-generic.xlsx");
  console.log(`   ${rows.length} rows found`);

  // 2. Fetch all drugs from Supabase to build name → id lookup
  console.log("\n🔍 Fetching drugs from Supabase for name matching...");
  let allDrugs = [];
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from("drugs")
      .select("id, name")
      .range(from, from + pageSize - 1);

    if (error) {
      console.error("Failed to fetch drugs:", error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    allDrugs = allDrugs.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  console.log(`   ${allDrugs.length} drugs loaded from Supabase`);

  // Build lookup map: normalized name → drugbank id
  const drugLookup = new Map();
  for (const drug of allDrugs) {
    drugLookup.set(normalizeName(drug.name), drug.id);
  }

  // 3. Process each row
  console.log("\n⚙️  Processing rows...\n");

  const toInsert = [];
  const notFound = [];
  const skipped = []; // rows with no brand name

  for (const row of rows) {
    const brandName = row["Brand Name"]?.toString().trim() || null;
    const genericName = row["Generic Name"]?.toString().trim() || null;
    const comboRaw = row["COMBINATION"];

    // Skip rows with no brand name
    if (!brandName) {
      skipped.push(genericName);
      continue;
    }

    // Parse the COMBINATION column — it's a JSON array string
    let ingredients = [];
    try {
      ingredients = JSON.parse(comboRaw);
    } catch (e) {
      console.warn(
        `   ⚠️  Could not parse COMBINATION for "${brandName}": ${comboRaw}`,
      );
      continue;
    }

    // Match each ingredient to a DrugBank ID
    const drugIds = [];
    const unmatchedIngredients = [];

    for (const ingredient of ingredients) {
      const drugId = drugLookup.get(normalizeName(ingredient));
      if (drugId) {
        drugIds.push(drugId);
      } else {
        unmatchedIngredients.push(ingredient);
      }
    }

    if (drugIds.length === 0) {
      // None of the ingredients matched — skip
      notFound.push({ brand: brandName, generic: genericName, ingredients });
      continue;
    }

    if (unmatchedIngredients.length > 0) {
      // Partial match — still insert but log the unmatched ones
      console.warn(
        `   ⚠️  Partial match for "${brandName}": unmatched → ${unmatchedIngredients.join(", ")}`,
      );
    }

    // Use the first matched drug_id as the primary link
    // Store all matched IDs in drug_ids array for combination lookups
    toInsert.push({
      drug_id: drugIds[0], // Primary drug FK
      drug_ids: drugIds, // All matched DrugBank IDs (for combos)
      ph_brand: brandName,
      generic_name: genericName,
      ingredients: ingredients, // Original ingredient names from COMBINATION
      is_combination: ingredients.length > 1,
    });
  }

  console.log(`✅ Matched:     ${toInsert.length} rows ready to insert`);
  console.log(`⚠️  Not found:  ${notFound.length} rows (no DrugBank match)`);
  console.log(`⏭️  Skipped:    ${skipped.length} rows (no brand name)`);

  if (notFound.length > 0) {
    console.log(
      "\n📋 Unmatched drugs (not yet in Supabase — upload more DrugBank data to fix):",
    );
    notFound.forEach((r) =>
      console.log(`   - ${r.brand} → ${r.ingredients.join(" + ")}`),
    );
  }

  if (toInsert.length === 0) {
    console.log(
      "\n⚠️  Nothing to insert. Make sure DrugBank data is uploaded to Supabase first.",
    );
    process.exit(0);
  }

  // 4. Clear existing ph_medicine_mapping and re-insert fresh
  console.log("\n🗑️  Clearing existing ph_medicine_mapping table...");
  const { error: deleteError } = await supabase
    .from("ph_medicine_mapping")
    .delete()
    .neq("id", 0); // delete all rows
  if (deleteError) {
    console.warn(
      "   Could not clear table (may be empty):",
      deleteError.message,
    );
  }

  // 5. Insert in chunks of 500
  console.log(
    `\n📤 Inserting ${toInsert.length} rows into ph_medicine_mapping...`,
  );
  let insertedCount = 0;
  const chunkSize = 500;

  for (let i = 0; i < toInsert.length; i += chunkSize) {
    const chunk = toInsert.slice(i, i + chunkSize);
    const { error } = await supabase.from("ph_medicine_mapping").insert(chunk);
    if (error) {
      console.error(
        `\n❌ Insert failed at chunk ${i}–${i + chunkSize}:`,
        error.message,
      );
    } else {
      insertedCount += chunk.length;
      process.stdout.write(
        `\r   ✅ ${insertedCount}/${toInsert.length} inserted...`,
      );
    }
  }

  console.log("\n\n" + "=".repeat(80));
  console.log("UPLOAD COMPLETE");
  console.log("=".repeat(80));
  console.log(`✅ Inserted:    ${insertedCount} PH brand mappings`);
  console.log(
    `⚠️  Not found:  ${notFound.length} (will auto-match as more drugs are uploaded)`,
  );
  console.log(
    `⏭️  Skipped:    ${skipped.length} (no brand name in source data)`,
  );
  console.log(
    "\n💡 Tip: Re-run this script after uploading more DrugBank data to pick up unmatched drugs.",
  );
  console.log("=".repeat(80));
}

main().catch(console.error);
