const fs = require("fs");
const path = require("path");
const glob = require("glob");

// Suffix for English locale keys
const DEFAULT_SUFFIX = "defaultText";

// Read locale files
function readLocaleFiles() {
  const localesDir = path.join(__dirname, "public", "locales");
  const locales = fs
    .readdirSync(localesDir)
    .filter((d) => fs.statSync(path.join(localesDir, d)).isDirectory());

  const allKeys = {};
  const allLocales = {};

  locales.forEach((locale) => {
    const translationPath = path.join(localesDir, locale, "translation.json");
    if (fs.existsSync(translationPath)) {
      allLocales[locale] = JSON.parse(fs.readFileSync(translationPath, "utf8"));
    }
  });

  // Extract all keys from all locales
  Object.keys(allLocales).forEach((locale) => {
    allKeys[locale] = Object.keys(allLocales[locale]);
  });

  return { allLocales, allKeys };
}

// Extract keys from t() calls in source files
function extractSourceKeys() {
  const srcDir = path.join(__dirname, "src");
  const extensions = ["**/*.{ts,tsx,js,jsx}"];

  const allKeys = new Set();

  extensions.forEach((ext) => {
    const files = glob.sync(path.join(srcDir, ext));

    files.forEach((file) => {
      try {
        const content = fs.readFileSync(file, "utf8");
        // Extract t('key' or t("key")
        const tCallMatches = content.matchAll(
          /t\(['"`]([^'"`]+)['"`](?:\s*,\s*['"`][^'"`]+['"`])?\)/g,
        );

        for (const match of tCallMatches) {
          if (match[1]) {
            allKeys.add(match[1]);
          }
        }
      } catch (err) {
        console.error(`Error reading ${file}:`, err.message);
      }
    });
  });

  return Array.from(allKeys).sort();
}

// Generate snake_case from various formats
function toSnakeCase(text) {
  // Split by spaces, camelCase, PascalCase, hyphens, underscores
  text = text
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .replace(/[-\s_]+/g, "_")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .replace(/^_+|_+$/g, "");

  return text;
}

// Analyze translations
function analyzeTranslations() {
  console.log("Reading locale files...");
  const { allLocales, allKeys } = readLocaleFiles();

  console.log("Extracting source keys...");
  const sourceKeys = extractSourceKeys();

  const locales = Object.keys(allLocales);

  // Collect all keys by locale existence
  const keysInAllLocales = {};
  const keysMissingInLocales = {};
  const orphanedKeys = {};

  const sourceKeysNormalized = new Set(sourceKeys.map((k) => k.toLowerCase()));

  // Check for orphaned keys (in locales but not in source)
  locales.forEach((locale) => {
    const localeKeys = Object.keys(allLocales[locale]);
    orphanedKeys[locale] = [];

    localeKeys.forEach((key) => {
      // Skip if key looks like pluralization or interpolation format
      if (/(_one|_two|_few|_many|_other|\{\{.*\}|\{\w+\})/.test(key)) return;

      if (!sourceKeysNormalized.has(key.toLowerCase())) {
        orphanedKeys[locale].push(key);
      }
    });
  });

  // Check for missing keys
  locales.forEach((locale) => {
    keysMissingInLocales[locale] = [];

    sourceKeys.forEach((key) => {
      if (!allLocales[locale][key]) {
        keysMissingInLocales[locale].push(key);
      }
    });
  });

  console.log("\nSource Keys Extracted:", sourceKeys.length);
  console.log("Keys in English locale:", Object.keys(allLocales["en"]).length);
  console.log(
    "Orphaned keys found:\n",
    Object.entries(orphanedKeys)
      .map(([loc, keys]) => `${loc}: ${keys.length}`)
      .join("\n"),
  );
  console.log(
    "\nKeys missing in locales:\n",
    Object.entries(keysMissingInLocales)
      .map(([loc, keys]) => `${loc}: ${keys.length}`)
      .join("\n"),
  );

  return {
    allLocales,
    allKeys,
    sourceKeys,
    orphanedKeys,
    keysMissingInLocales,
    keysInAllLocales,
  };
}

// Generate reports
function generateReports(data) {
  const { allLocales, sourceKeys, orphanedKeys, keysMissingInLocales } = data;
  const locales = Object.keys(allLocales);

  // Report: Missing keys by locale
  const sortedSourceKeys = [...sourceKeys].sort();

  console.log("\n=== MISSING KEYS (will be added with English defaults) ===");
  locales.forEach((locale) => {
    if (keysMissingInLocales[locale].length > 0) {
      console.log(`\n${locale.toUpperCase()}:`);
      keysMissingInLocales[locale].forEach((key) => {
        console.log(`  - ${key}`);
      });
    }
  });

  console.log(
    "\n=== ORPHANED KEYS (in locales but not in source - review needed) ===",
  );
  locales.forEach((locale) => {
    if (orphanedKeys[locale].length > 0) {
      console.log(`\n${locale.toUpperCase()}:`);
      orphanedKeys[locale].forEach((key) => {
        const defaultText = allLocales[locale][key];
        console.log(`  - ${key}: "${defaultText}"`);
      });
    }
  });

  return { sortedSourceKeys };
}

// Generate updated locale files
function updateLocaleFiles(data) {
  const { allLocales, keysMissingInLocales } = data;
  const locales = Object.keys(allLocales);

  locales.forEach((locale) => {
    const filePath = path.join(
      __dirname,
      "public",
      "locales",
      locale,
      "translation.json",
    );
    const localeData = allLocales[locale];

    let updated = false;

    // Add missing keys with English as default text
    keysMissingInLocales[locale].forEach((key) => {
      if (!localeData[key]) {
        // Use source key as English default when possible
        let defaultText = key.replace(/_/g, " ").replace(/\s+/g, " ").trim();
        // Capitalize first letter for sentence-like keys
        if (defaultText.length > 0) {
          defaultText =
            defaultText.charAt(0).toUpperCase() + defaultText.slice(1);
        }
        localeData[key] = defaultText.replace(/\s*\*$/g, " *");
        updated = true;
        console.log(`Added to ${locale}: ${key} => "${defaultText}"`);
      }
    });

    if (updated) {
      console.log(`Writing updated ${locale} translations...`);
      fs.writeFileSync(filePath, JSON.stringify(localeData, null, 2) + "\n");
    }
  });
}

// Run analysis
try {
  const data = analyzeTranslations();
  const reports = generateReports(data);

  console.log("\n=== UPDATE LOCALE FILES? ===");
  console.log("This will add missing keys to all locale files.");
  console.log("Review the missing keys list above.");
  console.log(
    'Type "yes" to proceed with updating locale files, or any other key to skip.',
  );

  const readline = require("readline").createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  readline.question("Update locale files? [yes/no]: ", (answer) => {
    if (answer.toLowerCase() === "yes") {
      updateLocaleFiles(data);
      console.log("\n✅ Locale files updated!");
    } else {
      console.log("⏩ Locale files NOT updated. Review output above.");
    }
    readline.close();
  });
} catch (err) {
  console.error("Error:", err);
  process.exit(1);
}
