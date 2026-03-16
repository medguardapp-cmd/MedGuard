const fs = require("fs");
const sax = require("sax");
const { createClient } = require("@supabase/supabase-js");

// ─────────────────────────────────────────────
// Supabase Init
// ─────────────────────────────────────────────
const SUPABASE_URL = "https://gbqotywkxwlcafvdimwi.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdicW90eXdreHdsY2FmdmRpbXdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MTM4NTIsImV4cCI6MjA4ODk4OTg1Mn0.sx6vtVPau7nW0wZNzwWP3QTzjv3pkRczED9SivtzVrI";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────
const BATCH_SIZE = 1;
const PROGRESS_FILE = "./supabase-upload-progress.json";
const drugsFile = "drugbank.xml";

// ─────────────────────────────────────────────
// Resume Support
// ─────────────────────────────────────────────
function loadProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf-8"));
  }
  return { totalUploaded: 0, uploaded: [], failed: [] };
}

function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// ─────────────────────────────────────────────
// Supabase Uploader
// ─────────────────────────────────────────────
async function uploadToSupabase(drug) {
  const id = drug["drugbank-id"];

  const { error: drugError } = await supabase.from("drugs").upsert({
    id,
    name: drug["name"] || null,
    state: drug["state"] || null,
    groups: drug["groups"] || [],
    class: drug["classification"]["class"] || null,
    subclass: drug["classification"]["subclass"] || null,
    description: drug["description"] || null,
    indication: drug["indication"] || null,
    pharmacodynamics: drug["pharmacodynamics"] || null,
    mechanism_of_action: drug["mechanism-of-action"] || null,
    toxicity: drug["toxicity"] || null,
    absorption: drug["absorption"] || null,
    half_life: drug["half-life"] || null,
    metabolism: drug["metabolism"] || null,
    protein_binding: drug["protein-binding"] || null,
    route_of_elimination: drug["route-of-elimination"] || null,
    clearance: drug["clearance"] || null,
    meta_type: drug["_metadata"]["type"] || null,
    meta_created: drug["_metadata"]["created"] || null,
    meta_updated: drug["_metadata"]["updated"] || null,
  });
  if (drugError) throw new Error(`Drug insert failed: ${drugError.message}`);

  if (drug["drug-interactions"].length > 0) {
    await supabase.from("drug_interactions").delete().eq("drug_id", id);
    const interactions = drug["drug-interactions"].map((i) => ({
      drug_id: id,
      interacts_with: i["drugbank-id"] || null,
      interacts_name: i["name"] || null,
      description: i["description"] || null,
    }));
    for (let i = 0; i < interactions.length; i += 1000) {
      const { error } = await supabase
        .from("drug_interactions")
        .insert(interactions.slice(i, i + 1000));
      if (error)
        throw new Error(`Interactions insert failed: ${error.message}`);
    }
  }

  if (drug["products"].length > 0) {
    await supabase.from("drug_products").delete().eq("drug_id", id);
    const products = drug["products"].map((p) => ({
      drug_id: id,
      name: p["name"] || null,
      generic: p["generic"] ?? null,
      strength: p["strength"] || null,
      dosage_form: p["dosage-form"] || null,
      route: p["route"] || null,
    }));
    for (let i = 0; i < products.length; i += 1000) {
      const { error } = await supabase
        .from("drug_products")
        .insert(products.slice(i, i + 1000));
      if (error) throw new Error(`Products insert failed: ${error.message}`);
    }
  }

  if (drug["dosages"].length > 0) {
    await supabase.from("drug_dosages").delete().eq("drug_id", id);
    const dosages = drug["dosages"].map((d) => ({
      drug_id: id,
      route: d["route"] || null,
      form: d["form"] || null,
      strength: d["strength"] || null,
    }));
    const { error } = await supabase.from("drug_dosages").insert(dosages);
    if (error) throw new Error(`Dosages insert failed: ${error.message}`);
  }

  if (drug["categories"].length > 0) {
    await supabase.from("drug_categories").delete().eq("drug_id", id);
    const categories = drug["categories"].map((c) => ({
      drug_id: id,
      category: c["category"] || null,
      mesh_id: c["mesh-id"] || null,
    }));
    const { error } = await supabase.from("drug_categories").insert(categories);
    if (error) throw new Error(`Categories insert failed: ${error.message}`);
  }

  if (drug["international-brands"].length > 0) {
    await supabase.from("drug_international_brands").delete().eq("drug_id", id);
    const brands = drug["international-brands"].map((b) => ({
      drug_id: id,
      name: b["name"] || null,
      company: b["company"] || null,
    }));
    const { error } = await supabase
      .from("drug_international_brands")
      .insert(brands);
    if (error)
      throw new Error(`International brands insert failed: ${error.message}`);
  }
}

// ─────────────────────────────────────────────
// SAX Parser — parses one batch from the XML
// starting at `skipCount` and collecting up to BATCH_SIZE drugs
// ─────────────────────────────────────────────
function parseBatch(skipCount) {
  return new Promise((resolve, reject) => {
    const parser = sax.createStream(true, { trim: true });

    let currentDrug = null;
    let currentPath = [];
    let drugDepth = 0;
    let drugsFound = [];
    let stopParsing = false;
    let globalDrugIndex = 0;
    let parseCount = 0;

    let inGroups = false;
    let inClassification = false;
    let inDrugInteractions = false;
    let inDosages = false;
    let inProducts = false;
    let inCategories = false;
    let inInternationalBrands = false;
    let inTargets = false;
    let inEnzymes = false;
    let inTransporters = false;
    let inCarriers = false;

    let currentInteraction = null;
    let currentDosage = null;
    let currentProduct = null;
    let currentCategory = null;
    let currentInternationalBrand = null;

    parser.on("opentag", (node) => {
      if (stopParsing) return;
      currentPath.push(node.name);

      if (node.name === "groups") inGroups = true;
      if (node.name === "classification") inClassification = true;
      if (node.name === "drug-interactions") inDrugInteractions = true;
      if (node.name === "dosages") inDosages = true;
      if (node.name === "products") inProducts = true;
      if (node.name === "categories") inCategories = true;
      if (node.name === "international-brands") inInternationalBrands = true;
      if (node.name === "targets") inTargets = true;
      if (node.name === "enzymes") inEnzymes = true;
      if (node.name === "transporters") inTransporters = true;
      if (node.name === "carriers") inCarriers = true;

      if (node.name === "drug") {
        drugDepth++;
        if (drugDepth === 1) {
          globalDrugIndex++;
          if (parseCount >= BATCH_SIZE) {
            stopParsing = true;
            return;
          }
          if (globalDrugIndex <= skipCount) {
            currentDrug = null;
            return;
          }
          currentDrug = {
            "drugbank-id": "",
            name: "",
            description: "",
            indication: "",
            pharmacodynamics: "",
            "mechanism-of-action": "",
            state: "",
            groups: [],
            classification: { class: "", subclass: "", description: "" },
            toxicity: "",
            "half-life": "",
            metabolism: "",
            "route-of-elimination": "",
            clearance: "",
            absorption: "",
            "protein-binding": "",
            "drug-interactions": [],
            dosages: [],
            products: [],
            categories: [],
            "international-brands": [],
            _metadata: {
              type: node.attributes?.type || null,
              created: node.attributes?.created || null,
              updated: node.attributes?.updated || null,
            },
          };
        }
        return;
      }

      if (!currentDrug || drugDepth === 0) return;

      if (node.name === "drugbank-id" && drugDepth === 1) {
        if (node.attributes?.primary === "true")
          currentDrug._foundPrimaryId = true;
        return;
      }

      if (inDrugInteractions && node.name === "drug-interaction") {
        currentInteraction = { "drugbank-id": "", name: "", description: "" };
        return;
      }
      if (inDosages && node.name === "dosage") {
        currentDosage = { route: "", form: "", strength: "" };
        return;
      }
      if (inProducts && node.name === "product") {
        currentProduct = {
          name: "",
          generic: false,
          strength: "",
          "dosage-form": "",
          route: "",
        };
        return;
      }
      if (inCategories && node.name === "category") {
        currentCategory = { category: "", "mesh-id": "" };
        return;
      }
      if (inInternationalBrands && node.name === "international-brand") {
        currentInternationalBrand = { name: "", company: "" };
        return;
      }
    });

    parser.on("text", (text) => {
      if (stopParsing || !currentDrug || drugDepth === 0) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      const lastTag = currentPath[currentPath.length - 1];

      if (currentDrug._foundPrimaryId && !currentDrug["drugbank-id"]) {
        currentDrug["drugbank-id"] = trimmed;
        currentDrug._foundPrimaryId = false;
        return;
      }

      if (
        drugDepth === 1 &&
        !inGroups &&
        !inClassification &&
        !inDrugInteractions &&
        !inDosages &&
        !inProducts &&
        !inCategories &&
        !inInternationalBrands &&
        !inTargets &&
        !inEnzymes &&
        !inTransporters &&
        !inCarriers
      ) {
        if (lastTag === "name" && !currentDrug["name"])
          currentDrug["name"] = trimmed;
        if (lastTag === "description" && !currentDrug["description"])
          currentDrug["description"] = trimmed;
        if (lastTag === "indication" && !currentDrug["indication"])
          currentDrug["indication"] = trimmed;
        if (lastTag === "pharmacodynamics" && !currentDrug["pharmacodynamics"])
          currentDrug["pharmacodynamics"] = trimmed;
        if (
          lastTag === "mechanism-of-action" &&
          !currentDrug["mechanism-of-action"]
        )
          currentDrug["mechanism-of-action"] = trimmed;
        if (lastTag === "state" && !currentDrug["state"])
          currentDrug["state"] = trimmed;
        if (lastTag === "toxicity" && !currentDrug["toxicity"])
          currentDrug["toxicity"] = trimmed;
        if (lastTag === "half-life" && !currentDrug["half-life"])
          currentDrug["half-life"] = trimmed;
        if (lastTag === "metabolism" && !currentDrug["metabolism"])
          currentDrug["metabolism"] = trimmed;
        if (
          lastTag === "route-of-elimination" &&
          !currentDrug["route-of-elimination"]
        )
          currentDrug["route-of-elimination"] = trimmed;
        if (lastTag === "clearance" && !currentDrug["clearance"])
          currentDrug["clearance"] = trimmed;
        if (lastTag === "absorption" && !currentDrug["absorption"])
          currentDrug["absorption"] = trimmed;
        if (lastTag === "protein-binding" && !currentDrug["protein-binding"])
          currentDrug["protein-binding"] = trimmed;
        return;
      }

      if (inGroups && lastTag === "group") {
        currentDrug["groups"].push(trimmed);
        return;
      }

      if (inClassification) {
        if (lastTag === "class")
          currentDrug["classification"]["class"] = trimmed;
        if (lastTag === "subclass")
          currentDrug["classification"]["subclass"] = trimmed;
        if (lastTag === "description")
          currentDrug["classification"]["description"] = trimmed;
        return;
      }

      if (currentInteraction) {
        if (lastTag === "drugbank-id")
          currentInteraction["drugbank-id"] = trimmed;
        if (lastTag === "name") currentInteraction["name"] = trimmed;
        if (lastTag === "description")
          currentInteraction["description"] = trimmed;
        return;
      }
      if (currentDosage) {
        if (lastTag === "route") currentDosage["route"] = trimmed;
        if (lastTag === "form") currentDosage["form"] = trimmed;
        if (lastTag === "strength") currentDosage["strength"] = trimmed;
        return;
      }
      if (currentProduct) {
        if (lastTag === "name") currentProduct["name"] = trimmed;
        if (lastTag === "generic")
          currentProduct["generic"] = trimmed.toLowerCase() === "true";
        if (lastTag === "strength") currentProduct["strength"] = trimmed;
        if (lastTag === "dosage-form") currentProduct["dosage-form"] = trimmed;
        if (lastTag === "route") currentProduct["route"] = trimmed;
        return;
      }
      if (currentCategory) {
        if (lastTag === "category") currentCategory["category"] = trimmed;
        if (lastTag === "mesh-id") currentCategory["mesh-id"] = trimmed;
        return;
      }
      if (currentInternationalBrand) {
        if (lastTag === "name") currentInternationalBrand["name"] = trimmed;
        if (lastTag === "company")
          currentInternationalBrand["company"] = trimmed;
        return;
      }
    });

    parser.on("closetag", (tagName) => {
      if (stopParsing) return;

      if (tagName === "groups") inGroups = false;
      if (tagName === "classification") inClassification = false;
      if (tagName === "drug-interactions") inDrugInteractions = false;
      if (tagName === "dosages") inDosages = false;
      if (tagName === "products") inProducts = false;
      if (tagName === "categories") inCategories = false;
      if (tagName === "international-brands") inInternationalBrands = false;
      if (tagName === "targets") inTargets = false;
      if (tagName === "enzymes") inEnzymes = false;
      if (tagName === "transporters") inTransporters = false;
      if (tagName === "carriers") inCarriers = false;

      if (tagName === "drug-interaction" && currentInteraction) {
        currentDrug["drug-interactions"].push(currentInteraction);
        currentInteraction = null;
      }
      if (tagName === "dosage" && currentDosage) {
        currentDrug["dosages"].push(currentDosage);
        currentDosage = null;
      }
      if (tagName === "product" && currentProduct) {
        currentDrug["products"].push(currentProduct);
        currentProduct = null;
      }
      if (tagName === "category" && currentCategory) {
        currentDrug["categories"].push(currentCategory);
        currentCategory = null;
      }
      if (tagName === "international-brand" && currentInternationalBrand) {
        currentDrug["international-brands"].push(currentInternationalBrand);
        currentInternationalBrand = null;
      }

      if (tagName === "drug") {
        drugDepth--;
        if (drugDepth === 0 && currentDrug && !stopParsing) {
          delete currentDrug._foundPrimaryId;
          drugsFound.push(currentDrug);
          parseCount++;
          if (parseCount >= BATCH_SIZE) {
            stopParsing = true;
            parser.end();
          }
          currentDrug = null;
        }
      }

      currentPath.pop();
    });

    parser.on("end", () => resolve(drugsFound));
    parser.on("error", (err) => {
      if (!stopParsing) reject(err);
    });

    fs.createReadStream(drugsFile).on("error", reject).pipe(parser);
  });
}

// ─────────────────────────────────────────────
// Main Loop — keeps running batches until done
// ─────────────────────────────────────────────
async function main() {
  console.log("=".repeat(80));
  console.log("DrugBank XML → Supabase  |  Auto-Loop Mode");
  console.log("=".repeat(80));
  console.log(`📦 Batch size:  ${BATCH_SIZE} drugs per batch`);
  console.log(`📄 Source:      ${drugsFile}`);
  console.log(`💾 Progress:    ${PROGRESS_FILE}`);
  console.log(`🔗 Supabase:    ${SUPABASE_URL}`);
  console.log("=".repeat(80) + "\n");

  let batchNumber = 0;

  while (true) {
    const progress = loadProgress();
    batchNumber++;

    const runStart = progress.totalUploaded + 1;
    const runEnd = progress.totalUploaded + BATCH_SIZE;

    console.log(`\n${"─".repeat(80)}`);
    console.log(
      `BATCH #${batchNumber}  |  Drugs #${runStart}–#${runEnd}  |  Total so far: ${progress.totalUploaded}`,
    );
    console.log(`${"─".repeat(80)}`);
    console.log("🔍 Parsing XML...");

    // Parse next batch
    const drugs = await parseBatch(progress.totalUploaded);

    if (drugs.length === 0) {
      console.log("\n🎉 ALL DRUGS UPLOADED! Nothing left to parse.");
      console.log(`   Total uploaded: ${progress.totalUploaded}`);
      break;
    }

    console.log(`✅ Parsed ${drugs.length} drugs — uploading to Supabase...\n`);

    let successCount = 0;
    let failCount = 0;

    for (const drug of drugs) {
      try {
        await uploadToSupabase(drug);

        progress.uploaded.push(drug["drugbank-id"]);
        progress.failed = progress.failed.filter(
          (id) => id !== drug["drugbank-id"],
        );
        progress.totalUploaded = (progress.totalUploaded || 0) + 1;
        saveProgress(progress);

        successCount++;
        process.stdout.write(
          `\r   ✅ ${successCount}/${drugs.length} | ` +
            `Total: ${progress.totalUploaded} | ` +
            `${drug["name"].padEnd(35)} | ` +
            `interactions: ${String(drug["drug-interactions"].length).padStart(4)} | ` +
            `products: ${String(drug["products"].length).padStart(3)}   `,
        );
      } catch (err) {
        if (!progress.failed.includes(drug["drugbank-id"]))
          progress.failed.push(drug["drugbank-id"]);
        saveProgress(progress);
        failCount++;
        console.error(
          `\n❌ Failed: ${drug["name"]} (${drug["drugbank-id"]}) — ${err.message}`,
        );
      }
    }

    console.log(
      `\n\n   Batch #${batchNumber} done — ✅ ${successCount} uploaded, ❌ ${failCount} failed`,
    );

    // Small pause between batches to avoid overwhelming Supabase
    console.log("   ⏳ Waiting 2 seconds before next batch...");
    await new Promise((r) => setTimeout(r, 2000));
  }

  const progress = loadProgress();
  console.log("\n" + "=".repeat(80));
  console.log("UPLOAD COMPLETE");
  console.log("=".repeat(80));
  console.log(`✅ Total uploaded:  ${progress.totalUploaded}`);
  console.log(`❌ Total failed:    ${progress.failed.length}`);
  if (progress.failed.length > 0) {
    console.log(`   Check ${PROGRESS_FILE} → "failed" array`);
  }
  console.log(`\n💡 Now run: node scripts/ph-mapping-upload.js`);
  console.log("=".repeat(80));

  process.exit(0);
}

main().catch(console.error);
