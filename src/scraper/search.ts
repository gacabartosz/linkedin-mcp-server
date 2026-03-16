/**
 * LinkedIn People & Company Search via Voyager API
 *
 * The Voyager API returns "normalized" JSON where the actual entity data
 * lives in the `included[]` array, and the main `data` contains references.
 */

import { voyagerRequest } from "./voyager.js";
import { log } from "../utils/logger.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SearchPerson {
  name: string;
  headline: string;
  location: string;
  profile_url: string;
  public_id: string;
  profile_urn: string;
  connection_degree: string;
  summary?: string;
}

export interface SearchCompany {
  name: string;
  description: string;
  url: string;
  company_id: string;
  employee_count?: number;
  industry?: string;
  logo_url?: string;
}

// ── Voyager Normalized Response ──────────────────────────────────────────────

interface VoyagerNormalizedResponse {
  data?: {
    data?: {
      searchDashClustersByAll?: {
        metadata?: { totalResultCount?: number; [key: string]: unknown };
        paging?: { count: number; start: number; total: number };
        elements?: Array<{
          items?: Array<{
            item?: {
              "*entityResult"?: string;  // URN reference to included[]
              entityResult?: VoyagerEntityResult;
            };
          }>;
        }>;
      };
    };
    // Sometimes data is not double-nested
    searchDashClustersByAll?: {
      metadata?: { totalResultCount?: number; [key: string]: unknown };
      paging?: { count: number; start: number; total: number };
      elements?: Array<{
        items?: Array<{
          item?: {
            "*entityResult"?: string;
            entityResult?: VoyagerEntityResult;
          };
        }>;
      }>;
    };
  };
  included?: VoyagerIncludedEntity[];
}

interface VoyagerEntityResult {
  title?: { text?: string };
  primarySubtitle?: { text?: string };
  secondarySubtitle?: { text?: string };
  navigationUrl?: string;
  entityUrn?: string;
  summary?: { text?: string; textDirection?: string };
  badgeText?: { text?: string };
  trackingUrn?: string;
  $type?: string;
}

interface VoyagerIncludedEntity {
  $type?: string;
  entityUrn?: string;
  title?: { text?: string };
  primarySubtitle?: { text?: string };
  secondarySubtitle?: { text?: string };
  navigationUrl?: string;
  summary?: { text?: string };
  badgeText?: { text?: string };
  trackingUrn?: string;
  [key: string]: unknown;
}

// ── GEO URN Mapping ──────────────────────────────────────────────────────────

const GEO_URNS: Record<string, string> = {
  "poland": "105080838",
  "polska": "105080838",
  "pl": "105080838",
  "warsaw": "105976498",
  "warszawa": "105976498",
  "krakow": "101851062",
  "kraków": "101851062",
  "wroclaw": "106261965",
  "wrocław": "106261965",
  "gdansk": "101613743",
  "gdańsk": "101613743",
  "poznan": "104052507",
  "poznań": "104052507",
  "germany": "101282230",
  "uk": "101165590",
  "united kingdom": "101165590",
  "usa": "103644278",
  "united states": "103644278",
  "europe": "100506914",
  "eu": "100506914",
  "france": "105015875",
  "netherlands": "102890719",
  "spain": "105646813",
  "italy": "103350119",
};

function resolveGeoUrn(location: string): string {
  const normalized = location.toLowerCase().trim();
  return GEO_URNS[normalized] || normalized;
}

// ── Parse Entity Results from Voyager Normalized Response ─────────────────────

function parseEntityResults(response: VoyagerNormalizedResponse, entityType: string): VoyagerEntityResult[] {
  const results: VoyagerEntityResult[] = [];

  // Strategy 1: Parse from `included[]` array (most reliable)
  const included = response.included || [];
  for (const entity of included) {
    const type = entity.$type || "";
    if (type.includes("EntityResultViewModel") || type.includes("entityResult")) {
      results.push(entity as VoyagerEntityResult);
    }
  }

  if (results.length > 0) {
    log("info", `Parsed ${results.length} entities from included[] (${entityType})`);
    return results;
  }

  // Strategy 2: Parse from nested data (fallback)
  const searchData = response.data?.data?.searchDashClustersByAll ||
                     response.data?.searchDashClustersByAll;

  if (searchData?.elements) {
    for (const cluster of searchData.elements) {
      for (const item of cluster.items || []) {
        const entity = item.item?.entityResult;
        if (entity?.title?.text) {
          results.push(entity);
        }
      }
    }
    log("info", `Parsed ${results.length} entities from nested data (${entityType})`);
  }

  return results;
}

function getTotalCount(response: VoyagerNormalizedResponse): number {
  const searchData = response.data?.data?.searchDashClustersByAll ||
                     response.data?.searchDashClustersByAll;
  return searchData?.metadata?.totalResultCount ||
         searchData?.paging?.total || 0;
}

// ── Search People ────────────────────────────────────────────────────────────

export async function searchPeople(options: {
  keywords?: string;
  title?: string;
  company_id?: string;
  location?: string;
  count?: number;
  start?: number;
}): Promise<{ results: SearchPerson[]; total: number }> {
  const count = Math.min(options.count || 10, 25);
  const start = options.start || 0;

  // Build filter list
  const filters: string[] = [];
  filters.push("(key:resultType,value:List(PEOPLE))");

  if (options.company_id) {
    filters.push(`(key:currentCompany,value:List(${options.company_id}))`);
  }
  if (options.location) {
    const geoUrn = resolveGeoUrn(options.location);
    filters.push(`(key:geoUrn,value:List(${geoUrn}))`);
  }
  if (options.title) {
    filters.push(`(key:title,value:List(${encodeURIComponent(options.title)}))`);
  }

  const keywords = options.keywords ? encodeURIComponent(options.keywords) : "";
  const filterStr = filters.join(",");

  const path =
    `/graphql?variables=(start:${start},origin:FACETED_SEARCH,query:` +
    `(keywords:${keywords},flagshipSearchIntent:SEARCH_SRP,` +
    `queryParameters:List(${filterStr}),includeFiltersInResponse:false))` +
    `&queryId=voyagerSearchDashClusters.b0928897b71bd00a5a7291755dcd64f0`;

  const response = await voyagerRequest<VoyagerNormalizedResponse>(path);

  const entities = parseEntityResults(response, "PEOPLE");
  const results: SearchPerson[] = [];

  for (const entity of entities) {
    const name = entity.title?.text;
    if (!name) continue;

    const navUrl = entity.navigationUrl || "";
    const publicId = navUrl.match(/\/in\/([^/?]+)/)?.[1] || "";
    const urn = entity.entityUrn || entity.trackingUrn || "";

    results.push({
      name,
      headline: entity.primarySubtitle?.text || "",
      location: entity.secondarySubtitle?.text || "",
      profile_url: navUrl.split("?")[0],
      public_id: publicId,
      profile_urn: urn,
      connection_degree: entity.badgeText?.text || "",
      summary: entity.summary?.text,
    });
  }

  const total = getTotalCount(response) || results.length;
  log("info", `Search returned ${results.length} people (total: ${total})`);

  return { results: results.slice(0, count), total };
}

// ── Search Companies ─────────────────────────────────────────────────────────

export async function searchCompanies(options: {
  keywords: string;
  count?: number;
  start?: number;
}): Promise<{ results: SearchCompany[]; total: number }> {
  const count = Math.min(options.count || 10, 25);
  const start = options.start || 0;
  const keywords = encodeURIComponent(options.keywords);

  const path =
    `/graphql?variables=(start:${start},origin:FACETED_SEARCH,query:` +
    `(keywords:${keywords},flagshipSearchIntent:SEARCH_SRP,` +
    `queryParameters:List((key:resultType,value:List(COMPANIES))),includeFiltersInResponse:false))` +
    `&queryId=voyagerSearchDashClusters.b0928897b71bd00a5a7291755dcd64f0`;

  const response = await voyagerRequest<VoyagerNormalizedResponse>(path);

  const entities = parseEntityResults(response, "COMPANIES");
  const results: SearchCompany[] = [];

  for (const entity of entities) {
    const name = entity.title?.text;
    if (!name) continue;

    const navUrl = entity.navigationUrl || "";
    const urn = entity.entityUrn || "";
    const companyId = urn.match(/company[^:]*:(\d+)/)?.[1] ||
                      navUrl.match(/\/company\/([^/?]+)/)?.[1] || "";

    results.push({
      name,
      description: entity.summary?.text || entity.primarySubtitle?.text || "",
      url: navUrl.split("?")[0],
      company_id: companyId,
      industry: entity.primarySubtitle?.text,
    });
  }

  const total = getTotalCount(response) || results.length;
  log("info", `Company search returned ${results.length} results (total: ${total})`);

  return { results: results.slice(0, count), total };
}

// ── Get Company People (employees) ───────────────────────────────────────────

export async function getCompanyPeople(options: {
  company_id: string;
  role_keywords?: string;
  count?: number;
  start?: number;
}): Promise<{ results: SearchPerson[]; total: number; company_id: string }> {
  const result = await searchPeople({
    keywords: options.role_keywords || "",
    company_id: options.company_id,
    count: options.count,
    start: options.start,
  });

  return {
    ...result,
    company_id: options.company_id,
  };
}

// ── Get Company Info ─────────────────────────────────────────────────────────

interface VoyagerCompanyResponse {
  staffCount?: number;
  name?: string;
  description?: string;
  tagline?: string;
  url?: string;
  staffCountRange?: { start?: number; end?: number };
  industries?: string[];
  headquarter?: { city?: string; country?: string };
  [key: string]: unknown;
}

export async function getCompanyInfo(companyId: string): Promise<{
  name: string;
  description: string;
  employee_count: number;
  industry: string;
  headquarters: string;
  url: string;
}> {
  const path = `/organization/companies?decorationId=com.linkedin.voyager.deco.organization.web.WebFullCompanyMain-40` +
    `&q=universalName&universalName=${encodeURIComponent(companyId)}`;

  const response = await voyagerRequest<{ elements?: VoyagerCompanyResponse[] }>(path);
  const company = response.elements?.[0];

  if (!company) {
    throw new Error(`Company not found: ${companyId}`);
  }

  return {
    name: company.name || companyId,
    description: company.description || company.tagline || "",
    employee_count: company.staffCount || company.staffCountRange?.start || 0,
    industry: (company.industries as string[])?.[0] || "",
    headquarters: company.headquarter
      ? `${company.headquarter.city || ""}, ${company.headquarter.country || ""}`.replace(/^, |, $/g, "")
      : "",
    url: company.url || `https://www.linkedin.com/company/${companyId}`,
  };
}

// ── Resolve Company URL to ID ────────────────────────────────────────────────

export function extractCompanyId(input: string): string {
  const match = input.match(/linkedin\.com\/company\/([^/?]+)/);
  if (match) return match[1];
  return input.trim();
}
