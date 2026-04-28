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

  const allLocales = {};

  locales.forEach((locale) => {
    const translationPath = path.join(localesDir, locale, "translation.json");
    if (fs.existsSync(translationPath)) {
      allLocales[locale] = JSON.parse(fs.readFileSync(translationPath, "utf8"));
    }
  });

  return { allLocales };
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
  const { allLocales } = readLocaleFiles();

  console.log("Extracting source keys...");
  const sourceKeys = extractSourceKeys();

  const locales = Object.keys(allLocales);

  // Check for orphaned keys (in locales but not in source)
  const orphanedKeys = {};
  const keysMissingInLocales = {};
  const sourceKeysNormalized = new Set(sourceKeys.map((k) => k.toLowerCase()));

  locales.forEach((locale) => {
    const localeKeys = Object.keys(allLocales[locale]);
    orphanedKeys[locale] = [];

    localeKeys.forEach((key) => {
      // Skip if key looks like pluralization or interpolation format
      if (/(_one$|_two$|_few$|_many$|_other$|\{\{.*\}|\{\w+\})/.test(key))
        return;

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

  console.log("\n=== ANALYSIS SUMMARY ===");
  console.log("Source Keys Extracted:", sourceKeys.length);
  locales.forEach((locale) => {
    console.log(
      `${locale.toUpperCase()} locale keys:`,
      Object.keys(allLocales[locale]).length,
    );
  });
  console.log("");
  locales.forEach((locale) => {
    console.log(
      `${locale.toUpperCase()} orphaned keys: ${orphanedKeys[locale].length}`,
    );
  });
  console.log("");
  locales.forEach((locale) => {
    console.log(
      `${locale.toUpperCase()} missing keys: ${keysMissingInLocales[locale].length}`,
    );
  });

  return {
    allLocales,
    sourceKeys,
    orphanedKeys,
    keysMissingInLocales,
  };
}

// Generate reports
function generateReports(data) {
  const { allLocales, sourceKeys, orphanedKeys, keysMissingInLocales } = data;
  const locales = Object.keys(allLocales);

  const sortedSourceKeys = [...sourceKeys].sort();

  console.log("\n=== MISSING KEYS (will be added with English defaults) ===");
  locales.forEach((locale) => {
    if (keysMissingInLocales[locale].length > 0) {
      console.log(`\n${locale.toUpperCase()}:`);
      keysMissingInLocales[locale].slice(0, 20).forEach((key) => {
        console.log(`  - ${key}`);
      });
      if (keysMissingInLocales[locale].length > 20)
        console.log(
          `  ... and ${keysMissingInLocales[locale].length - 20} more`,
        );
    }
  });

  console.log(
    "\n=== ORPHANED KEYS (in locales but not in source - review needed) ===",
  );
  locales.forEach((locale) => {
    if (orphanedKeys[locale].length > 0) {
      console.log(`\n${locale.toUpperCase()}:`);
      orphanedKeys[locale].slice(0, 20).forEach((key) => {
        const defaultText = allLocales[locale][key];
        console.log(`  - ${key}: "${defaultText}"`);
      });
      if (orphanedKeys[locale].length > 20)
        console.log(`  ... and ${orphanedKeys[locale].length - 20} more`);
    } else {
      console.log(`\n${locale.toUpperCase()}: No orphaned keys`);
    }
  });

  console.log("\n=== SOURCE KEYS (sample top 50) ===");
  sourceKeys.slice(0, 50).forEach((key) => console.log(`  ${key}`));
  if (sourceKeys.length > 50)
    console.log(`  ... and ${sourceKeys.length - 50} more`);

  return { sortedSourceKeys };
}

// Generate updated locale files
function updateLocaleFiles(data) {
  const { allLocales, keysMissingInLocales } = data;
  const locales = Object.keys(allLocales);

  let filesUpdated = 0;

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

    // Add missing keys with English as default text (using English as basis)
    keysMissingInLocales[locale].forEach((key) => {
      if (!localeData[key]) {
        // Use English translation as default
        const defaultText = key.replace(/_/g, " ").replace(/^./, function (c) {
          return c.toUpperCase();
        });
        // Keep asterisk for required fields
        let englishText = defaultText;
        if (
          key.includes("required") ||
          key.endsWith("required") ||
          key.endsWith("_required")
        ) {
          englishText = defaultText.replace(/\s*\*$/, " *");
        }
        localeData[key] = englishText;
        updated = true;
      }
    });

    if (updated) {
      fs.writeFileSync(filePath, JSON.stringify(localeData, null, 2) + "\n");
      console.log(
        `✓ Updated ${locale}: ${keysMissingInLocales[locale].length} new keys added`,
      );
      filesUpdated++;
    }
  });

  return filesUpdated;
}

// Run analysis
const data = analyzeTranslations();
const reports = generateReports(data);

console.log("\n=== UPDATE LOCALE FILES? ===");
console.log("This will add all missing keys to locale files.");
console.log("All orphaned keys will be reviewed for removal.");
console.log('Type "yes" to proceed, or any other key to skip.');

const readline = require("readline").createInterface({
  input: process.stdin,
  output: process.stdout,
});

readline.question("Update locale files? [yes/no]: ", (answer) => {
  if (answer.toLowerCase() === "yes") {
    const filesUpdated = updateLocaleFiles(data);
    if (filesUpdated > 0) {
      console.log(`\n✅ Successfully updated ${filesUpdated} locale file(s)!`);
    }
  } else {
    console.log("⏩ Locale files NOT updated. Review output above.");
  }
  readline.close();
});
