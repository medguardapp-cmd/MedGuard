const fs = require("fs");
const sax = require("sax");
const admin = require("firebase-admin");

// ─────────────────────────────────────────────
// Firebase Init
// ─────────────────────────────────────────────
const serviceAccount = require("../serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ─────────────────────────────────────────────
// Config
// How many drugs to upload per run.
// Each run picks up where the last one left off.
// Example:
//   Run 1 → uploads DB00001–DB00500
//   Run 2 → uploads DB00501–DB01000
//   Run 3 → uploads DB01001–DB01500
//   ...and so on until all drugs are done.
// ─────────────────────────────────────────────
const BATCH_SIZE = 200;
const PROGRESS_FILE = "./upload-progress.json";
const drugsFile = "drugbank.xml";

// ─────────────────────────────────────────────
// Resume / Progress Support
// ─────────────────────────────────────────────
function loadProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    const raw = fs.readFileSync(PROGRESS_FILE, "utf-8");
    return JSON.parse(raw);
  }
  // totalUploaded tracks the global offset so each run
  // knows where to start parsing from
  return { totalUploaded: 0, uploaded: [], failed: [] };
}

function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// ─────────────────────────────────────────────
// Firebase Schema Builder
// ─────────────────────────────────────────────
function toFirebaseSchema(drug) {
  const mainDoc = {
    id: drug["drugbank-id"],
    name: drug["name"],
    state: drug["state"] || null,
    groups: drug["groups"],
    classification: {
      class: drug["classification"]["class"] || null,
      subclass: drug["classification"]["subclass"] || null,
    },
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
    categories: drug["categories"].map((c) => ({
      category: c["category"] || null,
      mesh_id: c["mesh-id"] || null,
    })),
    dosages: drug["dosages"].map((d) => ({
      route: d["route"] || null,
      form: d["form"] || null,
      strength: d["strength"] || null,
    })),
    international_brands: drug["international-brands"].map((b) => ({
      name: b["name"] || null,
      company: b["company"] || null,
    })),
    metadata: {
      type: drug["_metadata"]["type"] || null,
      created: drug["_metadata"]["created"] || null,
      updated: drug["_metadata"]["updated"] || null,
    },
  };

  const interactions = drug["drug-interactions"].map((i) => ({
    _docId: i["drugbank-id"],
    id: i["drugbank-id"] || null,
    name: i["name"] || null,
    description: i["description"] || null,
  }));

  const products = drug["products"].map((p) => ({
    name: p["name"] || null,
    generic: p["generic"] ?? null,
    strength: p["strength"] || null,
    dosage_form: p["dosage-form"] || null,
    route: p["route"] || null,
  }));

  return { mainDoc, interactions, products };
}

// ─────────────────────────────────────────────
// Firebase Uploader
// ─────────────────────────────────────────────
function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function uploadToFirebase({ mainDoc, interactions, products }) {
  const drugRef = db.collection("drugs").doc(mainDoc.id);

  // 1. Write main document
  await drugRef.set(mainDoc);

  // 2. Write interactions subcollection in chunks of 500
  if (interactions.length > 0) {
    const chunks = chunkArray(interactions, 500);
    for (const chunk of chunks) {
      const batch = db.batch();
      chunk.forEach((interaction) => {
        const docId = interaction._docId || db.collection("_").doc().id;
        const ref = drugRef.collection("interactions").doc(docId);
        const { _docId, ...data } = interaction;
        batch.set(ref, data);
      });
      await batch.commit();
    }
  }

  // 3. Write products subcollection in chunks of 500
  if (products.length > 0) {
    const chunks = chunkArray(products, 500);
    for (const chunk of chunks) {
      const batch = db.batch();
      chunk.forEach((product) => {
        const ref = drugRef.collection("products").doc();
        batch.set(ref, product);
      });
      await batch.commit();
    }
  }
}

// ─────────────────────────────────────────────
// SAX Parser State
// ─────────────────────────────────────────────
const parser = sax.createStream(true, { trim: true });

let currentDrug = null;
let currentPath = [];
let drugDepth = 0;
let stopParsing = false;

// Counters for windowed parsing
// skipCount  = how many top-level drugs to skip (already uploaded in previous runs)
// parseCount = how many drugs we've collected in this run (stops at BATCH_SIZE)
let skipCount = 0;
let parseCount = 0;
let globalDrugIndex = 0; // increments for every top-level <drug> tag seen

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

// Drugs collected in this run (only the current batch window)
let drugsFound = [];

// Load progress before starting so we know the offset
const progress = loadProgress();
skipCount = progress.totalUploaded;

// ─────────────────────────────────────────────
// SAX Events
// ─────────────────────────────────────────────
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

      // Stop once we've collected a full batch
      if (parseCount >= BATCH_SIZE) {
        stopParsing = true;
        return;
      }

      // Skip drugs from previous runs
      if (globalDrugIndex <= skipCount) {
        currentDrug = null; // don't capture
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
    if (node.attributes && node.attributes.primary === "true") {
      currentDrug._foundPrimaryId = true;
    }
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
    if (lastTag === "class") currentDrug["classification"]["class"] = trimmed;
    if (lastTag === "subclass")
      currentDrug["classification"]["subclass"] = trimmed;
    if (lastTag === "description")
      currentDrug["classification"]["description"] = trimmed;
    return;
  }

  if (currentInteraction) {
    if (lastTag === "drugbank-id") currentInteraction["drugbank-id"] = trimmed;
    if (lastTag === "name") currentInteraction["name"] = trimmed;
    if (lastTag === "description") currentInteraction["description"] = trimmed;
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
    if (lastTag === "company") currentInternationalBrand["company"] = trimmed;
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
      const shaped = toFirebaseSchema(currentDrug);
      drugsFound.push(shaped);
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

// ─────────────────────────────────────────────
// Upload on Parse Complete
// ─────────────────────────────────────────────
parser.on("end", async () => {
  if (drugsFound.length === 0) {
    console.log(
      "\n✅ All drugs have already been uploaded! Nothing left to do.",
    );
    console.log(`   Total uploaded: ${progress.totalUploaded}`);
    console.log(`   Delete ${PROGRESS_FILE} to start a fresh upload.`);
    process.exit(0);
  }

  const runStart = progress.totalUploaded + 1;
  const runEnd = progress.totalUploaded + drugsFound.length;

  console.log("\n" + "=".repeat(80));
  console.log(
    `PARSING COMPLETE — ${drugsFound.length} drugs parsed (drugs #${runStart}–#${runEnd})`,
  );
  console.log(`📤 Uploading to Firebase...`);
  console.log("=".repeat(80) + "\n");

  let successCount = 0;
  let failCount = 0;

  for (const drug of drugsFound) {
    const { mainDoc, interactions, products } = drug;
    try {
      await uploadToFirebase(drug);

      progress.uploaded.push(mainDoc.id);
      progress.failed = progress.failed.filter((id) => id !== mainDoc.id);
      progress.totalUploaded = (progress.totalUploaded || 0) + 1;
      saveProgress(progress);

      successCount++;
      process.stdout.write(
        `\r   ✅ ${successCount}/${drugsFound.length} this run | ` +
          `Total: ${progress.totalUploaded} | ` +
          `${mainDoc.name.padEnd(35)} | ` +
          `interactions: ${String(interactions.length).padStart(4)} | ` +
          `products: ${String(products.length).padStart(3)}   `,
      );
    } catch (err) {
      if (!progress.failed.includes(mainDoc.id)) {
        progress.failed.push(mainDoc.id);
      }
      saveProgress(progress);
      failCount++;
      console.error(
        `\n❌ Failed: ${mainDoc.name} (${mainDoc.id}) — ${err.message}`,
      );
    }
  }

  console.log("\n\n" + "=".repeat(80));
  console.log("RUN COMPLETE");
  console.log("=".repeat(80));
  console.log(`✅ Uploaded this run:       ${successCount}`);
  console.log(`📦 Total uploaded so far:   ${progress.totalUploaded}`);
  if (failCount > 0) {
    console.log(`❌ Failed this run:         ${failCount}`);
    console.log(`   Check ${PROGRESS_FILE} → "failed" array`);
  }
  console.log(
    `\n▶️  Run the script again to upload the next ${BATCH_SIZE} drugs.`,
  );
  console.log(`   Delete ${PROGRESS_FILE} to start over from the beginning.`);
  console.log("=".repeat(80));

  process.exit(0);
});

parser.on("error", (error) => {
  if (!stopParsing) console.error("Parsing error:", error);
});

// ─────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────
const runStart = progress.totalUploaded + 1;
const runEnd = progress.totalUploaded + BATCH_SIZE;

console.log("=".repeat(80));
console.log(`DrugBank → Firebase Upload`);
console.log("=".repeat(80));
console.log(`📦 Batch size:     ${BATCH_SIZE} drugs per run`);
console.log(`⏭️  Skipping first: ${progress.totalUploaded} (already uploaded)`);
console.log(`🎯 This run:       drugs #${runStart} → #${runEnd}`);
console.log(`📄 Source:         ${drugsFile}`);
console.log(`💾 Progress file:  ${PROGRESS_FILE}`);
console.log(`🔥 Collection:     drugs/{drugbank-id}`);
console.log("=".repeat(80));
console.log("\n🔍 Parsing XML...\n");

fs.createReadStream(drugsFile)
  .on("error", (error) => console.error("Stream error:", error))
  .pipe(parser);
