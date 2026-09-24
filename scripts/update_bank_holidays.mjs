// Fetch the latest England & Wales bank holidays from gov.uk and write web/bankholidays.js
import fs from "node:fs";
import { execSync } from "node:child_process";

const url = "https://www.gov.uk/bank-holidays.json";
console.log(`Fetching bank holidays from ${url}...`);

let raw;
try {
  raw = execSync(`curl -s "${url}"`, { encoding: "utf8" });
} catch (err) {
  console.error("Failed to fetch with curl:", err);
  process.exit(1);
}

const data = JSON.parse(raw);
const ew = data["england-and-wales"]?.events || [];
const filtered = ew.filter((e) => e.date >= "2025-01-01" && e.date <= "2028-12-31");

const content = `// Vendored England & Wales bank holiday snapshot (2025–2028)
// Sourced from https://www.gov.uk/bank-holidays.json
// Refreshed: ${new Date().toISOString()}
// Run: node scripts/update_bank_holidays.mjs to update

export const BANK_HOLIDAYS_ENGLAND_WALES = ${JSON.stringify(filtered, null, 2)};

export const BANK_HOLIDAY_DATES = new Set(BANK_HOLIDAYS_ENGLAND_WALES.map((e) => e.date));
`;

fs.writeFileSync(new URL("../web/bankholidays.js", import.meta.url), content);
console.log(`web/bankholidays.js updated with ${filtered.length} holidays.`);
