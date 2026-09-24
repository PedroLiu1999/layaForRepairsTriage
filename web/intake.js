// Deterministic intake pre-checks that run in code before the model.
// Enforces language guards, short text minimums, and an emergency keyword tripwire.

export const EMERGENCY_KEYWORDS = [
  "gas",
  "smell of gas",
  "gaz",
  "gazu",
  "sparks",
  "sparking",
  "electric shock",
  "shock",
  "scântei",
  "smoke",
  "fum",
  "fire",
  "pożar",
  "foc",
  "fuego",
  "flooding",
  "ceiling collapse",
  "carbon monoxide",
  "co alarm",
  "no heating",
  "no water",
];

// Common non-English stop-words that do not overlap with common English words
const FOREIGN_STOPWORDS = new Set([
  // Polish
  "się", "jest", "nie", "dla", "cieknącej", "pleśń", "grzyb", "śmierdzi", "stęchlizną", "oraz", "przez", "tylko", "bardzo", "pokoju", "ściana",
  "dzień", "dobry", "kaloryfer", "proszę", "mamy", "dziecko", "domu", "grzeje", "kapie", "zaworu", "dużym", "ogóle", "boimy", "ulatnia", "kuchence", "płomień",
  // Romanian
  "și", "nu", "în", "din", "pentru", "este", "sunt", "foarte", "acest", "apartament",
  "bună", "buna", "ziua", "avem", "probleme", "igrasie", "mucegai", "perete", "peretele", "dormitor", "umed", "aerul", "scântei", "tabloul", "electric", "siguranțe", "toată",
  // Spanish & Portuguese
  "hola", "tardes", "días", "tenemos", "fuga", "debajo", "bañera", "baño", "pasillo", "ayuda", "tiene", "pero", "está",
  "olá", "ola", "bom", "dia", "tem", "temos", "água", "pingando", "teto", "sala", "pintura", "estufada", "manchada", "amarelo",
  // Turkish
  "merhaba", "salon", "yatak", "odası", "odasında", "odasındaki", "petekleri", "gibi", "kombi", "arıza", "veriyor", "sıcak", "akmıyor",
  // Somali
  "asc", "musqusha", "biyaha", "ayaa", "daadanaya", "fidiya", "qolka", "fadhiga", "fadlan", "dira", "degdeg",
  // French & German
  "dans", "avec", "pour", "très", "auf", "nicht", "und", "haben",
]);

const ENGLISH_COMMON_WORDS = new Set([
  "the", "and", "they", "this", "that", "have", "there", "with", "from", "please", "house", "repair", "bedroom", "kitchen", "bathroom", "flooding", "broken",
]);

/**
 * Perform pre-checks on tenant report text before invoking the model.
 *
 * @param {string} text - Raw report text
 * @returns {{
 *   proceed: boolean,
 *   forcedOutcome?: string,
 *   flags: {
 *     tripwire: boolean,
 *     tripwireMatches: string[],
 *     wordCount: number,
 *     languageGuard: boolean,
 *     shortText: boolean
 *   }
 * }}
 */
export function preCheck(text) {
  const str = String(text ?? "").trim();
  const words = str ? str.split(/\s+/).filter(Boolean) : [];
  const wordCount = words.length;

  // 1. Keyword tripwire check (can only raise priority)
  const lower = str.toLowerCase();
  const tripwireMatches = [];
  for (const kw of EMERGENCY_KEYWORDS) {
    const rx = new RegExp(`(^|[^a-z0-9])${kw.replace(/\s+/g, "\\s+")}([^a-z0-9]|$)`, "i");
    if (rx.test(lower)) {
      tripwireMatches.push(kw);
    }
  }
  const tripwire = tripwireMatches.length > 0;

  // 2. Language guard
  // (a) Non-Latin script check: ratio of non-Latin alphabetic characters > 0.3
  const letters = str.match(/[\p{L}]/gu) || [];
  const nonLatinLetters = str.match(/[^\p{Script=Latin}\s\d\p{P}]/gu) || [];
  const nonLatinRatio = letters.length > 0 ? nonLatinLetters.length / letters.length : 0;
  let isForeign = nonLatinRatio > 0.3;

  // (b) Latin-script foreign stopword check (Polish, Romanian, Spanish, etc.)
  if (!isForeign && words.length >= 2) {
    const cleanWords = words.map((w) => w.toLowerCase().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ""));
    const foreignCount = cleanWords.filter((w) => FOREIGN_STOPWORDS.has(w)).length;
    const englishCount = cleanWords.filter((w) => ENGLISH_COMMON_WORDS.has(w)).length;

    if (foreignCount >= 2) {
      isForeign = true;
    } else if (cleanWords.length > 0 && foreignCount >= 1 && englishCount === 0) {
      isForeign = true;
    }
  }

  if (isForeign) {
    return {
      proceed: false,
      forcedOutcome: "Needs translation / human triage",
      flags: {
        tripwire,
        tripwireMatches,
        wordCount,
        languageGuard: true,
        shortText: false,
      },
    };
  }

  // 3. Short or empty text guard: fewer than 5 words goes to triage officer
  if (wordCount < 5) {
    return {
      proceed: false,
      forcedOutcome: "Triage officer decides",
      flags: {
        tripwire,
        tripwireMatches,
        wordCount,
        languageGuard: false,
        shortText: true,
      },
    };
  }

  // Ready for model triage
  return {
    proceed: true,
    flags: {
      tripwire,
      tripwireMatches,
      wordCount,
      languageGuard: false,
      shortText: false,
    },
  };
}

/**
 * Check if the tripwire should escalate a completed workflow run.
 * If tripwire is true and the model did not reach emergency handling, escalate to urgent_review.
 *
 * @param {object} run - Workflow trace returned by runWorkflow
 * @param {object} flags - Intake flags from preCheck
 * @returns {{ escalate: boolean, reason?: string }}
 */
export function postCheck(run, flags) {
  if (!flags?.tripwire) {
    return { escalate: false };
  }

  // Check if model route reached make_safe_24h or urgent_review or emergency_outcome
  const reachedEmergency =
    run.outcome?.nodeId === "emergency_outcome" ||
    run.outcome?.nodeId === "urgent_review" ||
    run.steps?.some((s) => s.nodeId === "make_safe_24h" || s.nodeId === "urgent_review");

  if (!reachedEmergency) {
    return {
      escalate: true,
      reason: "keyword tripwire overrode model route",
    };
  }

  return { escalate: false };
}
