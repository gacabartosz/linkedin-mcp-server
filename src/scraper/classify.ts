/**
 * AI-powered Intent Classification for LinkedIn Activities
 *
 * Uses Gemini Flash to classify posts/comments as:
 * - sales_pitch: Person is pitching/offering services
 * - buying_signal: Person is looking for a vendor/solution
 * - job_posting: Hiring or looking for a job
 * - networking: General networking, recommendations
 * - irrelevant: Personal, lifestyle, unrelated
 */

import { generateText } from "../gemini/client.js";
import { log } from "../utils/logger.js";

export interface ClassificationResult {
  classification: "sales_pitch" | "buying_signal" | "job_posting" | "networking" | "irrelevant";
  confidence: number;       // 0-100
  reasoning: string;        // Short explanation
  keywords_found: string[]; // Matched keywords
  is_actionable: boolean;   // Should this trigger an alert?
}

// ── E-commerce & IT Keywords ─────────────────────────────────────────────────

const BUYING_KEYWORDS = [
  "szukam", "szukamy", "potrzebuję", "potrzebujemy",
  "polecicie", "polecacie", "kto zrobi", "ktoś poleci",
  "wdrożenie", "wdrożyć", "upgrade", "migracja", "replatforming",
  "looking for", "searching for", "need help", "recommend",
  "anyone know", "suggestions for", "which platform",
  "RFP", "zapytanie ofertowe", "brief", "przetarg",
  "magento", "shopify", "woocommerce", "prestashop", "salesforce commerce",
  "headless", "composable", "pim", "erp", "crm",
  "e-commerce", "ecommerce", "sklep internetowy", "platforma sprzedażowa",
  "budżet", "budget", "wycena", "proposal",
];

const SALES_KEYWORDS = [
  "polecam się", "poleca się", "oferujemy", "specjalizujemy się",
  "zapraszam", "chętnie pomożemy", "skontaktuj się",
  "we offer", "we specialize", "happy to help", "reach out",
  "case study", "realizacja", "wdrożyliśmy", "pomogliśmy",
  "nasz klient", "our client", "projekt dla", "project for",
  "portfolio", "referencje",
];

const JOB_KEYWORDS = [
  "hiring", "zatrudnimy", "szukamy do zespołu", "rekrutacja",
  "job opening", "oferta pracy", "dołącz do nas", "join us",
  "stanowisko", "e-commerce manager", "head of e-commerce",
  "e-commerce specialist", "developer", "frontend", "backend",
];

// ── Quick Classification (keyword-based, no AI) ─────────────────────────────

export function quickClassify(text: string): ClassificationResult | null {
  const lower = text.toLowerCase();

  const buyingHits = BUYING_KEYWORDS.filter((k) => lower.includes(k.toLowerCase()));
  const salesHits = SALES_KEYWORDS.filter((k) => lower.includes(k.toLowerCase()));
  const jobHits = JOB_KEYWORDS.filter((k) => lower.includes(k.toLowerCase()));

  // Strong signal: 3+ buying keywords
  if (buyingHits.length >= 3) {
    return {
      classification: "buying_signal",
      confidence: 70 + buyingHits.length * 5,
      reasoning: `Strong keyword match: ${buyingHits.join(", ")}`,
      keywords_found: buyingHits,
      is_actionable: true,
    };
  }

  // Strong signal: 3+ sales keywords
  if (salesHits.length >= 3) {
    return {
      classification: "sales_pitch",
      confidence: 70 + salesHits.length * 5,
      reasoning: `Strong keyword match: ${salesHits.join(", ")}`,
      keywords_found: salesHits,
      is_actionable: true,
    };
  }

  // Job posting
  if (jobHits.length >= 2) {
    return {
      classification: "job_posting",
      confidence: 65 + jobHits.length * 5,
      reasoning: `Job keywords: ${jobHits.join(", ")}`,
      keywords_found: jobHits,
      is_actionable: true,
    };
  }

  // Not enough signal for quick classification
  return null;
}

// ── Full AI Classification (Gemini) ──────────────────────────────────────────

export async function classifyIntent(
  text: string,
  context?: {
    person_name?: string;
    person_headline?: string;
    activity_type?: string;
    original_post?: string;
  },
): Promise<ClassificationResult> {
  // Try quick classification first
  const quick = quickClassify(text);
  if (quick && quick.confidence >= 80) {
    return quick;
  }

  // Fall back to AI classification
  const system = `You are a B2B sales intelligence analyst specializing in e-commerce industry in Poland.
Your job is to classify LinkedIn activities to identify:
1. Sales pitches — competitors offering their services
2. Buying signals — potential clients looking for vendors/solutions
3. Job postings — companies hiring e-commerce roles
4. Networking — general professional networking
5. Irrelevant — personal posts, lifestyle, unrelated topics

IMPORTANT CONTEXT:
- We are an e-commerce development agency (Magento, Shopify, headless commerce)
- We look for: e-commerce platform migrations, new store builds, consulting needs
- Competitors include: software houses, e-commerce agencies, freelancers
- Target clients: e-commerce managers, CTOs, heads of digital at retail/B2C companies

CLASSIFICATION RULES:
- "buying_signal": Person is actively looking for a vendor, asking for recommendations, posting RFPs, or discussing platform choices
- "sales_pitch": Person is offering services, responding to RFPs with their company pitch, or promoting capabilities
- "job_posting": Hiring for e-commerce/IT roles (signals company growth = potential future client)
- "networking": Professional but not directly actionable (event invites, congratulations, thought leadership)
- "irrelevant": Personal lifestyle, unrelated industry, generic motivational

Return ONLY valid JSON:
{"classification":"...","confidence":0-100,"reasoning":"short explanation","keywords_found":["..."],"is_actionable":true/false}`;

  const prompt = `${context?.activity_type === "comment" ? "COMMENT" : "POST"} by ${context?.person_name || "Unknown"} (${context?.person_headline || "Unknown role"}):

"${text.substring(0, 1000)}"

${context?.original_post ? `\nOriginal post being commented on:\n"${context.original_post.substring(0, 500)}"` : ""}

Classify this activity.`;

  try {
    const raw = await generateText({ system, prompt, maxTokens: 200 });
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as ClassificationResult;
      // Merge with quick classification if available
      if (quick && quick.confidence > parsed.confidence) {
        return { ...parsed, keywords_found: [...quick.keywords_found, ...parsed.keywords_found] };
      }
      return parsed;
    }
  } catch (err) {
    log("warn", `AI classification failed: ${(err as Error).message}`);
  }

  // Fallback: return quick classification or default
  return quick || {
    classification: "irrelevant",
    confidence: 30,
    reasoning: "Could not classify (AI unavailable, no keyword match)",
    keywords_found: [],
    is_actionable: false,
  };
}

// ── Batch Classification ─────────────────────────────────────────────────────

export async function classifyBatch(
  items: Array<{
    text: string;
    person_name?: string;
    person_headline?: string;
    activity_type?: string;
    original_post?: string;
  }>,
): Promise<ClassificationResult[]> {
  const results: ClassificationResult[] = [];
  for (const item of items) {
    const result = await classifyIntent(item.text, {
      person_name: item.person_name,
      person_headline: item.person_headline,
      activity_type: item.activity_type,
      original_post: item.original_post,
    });
    results.push(result);
  }
  return results;
}
