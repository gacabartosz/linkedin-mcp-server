/**
 * LinkedIn Person Activity Monitor via Voyager API
 *
 * Uses the profileUpdatesV2 endpoint which returns normalized JSON.
 * Activity data is in `included[]` as UpdateV2 entities.
 * Requires member URN (not public_id) — resolved via search first.
 */

import { voyagerRequest } from "./voyager.js";
import { log } from "../utils/logger.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PersonActivity {
  type: "post" | "comment" | "reaction" | "share";
  text: string;
  date: string;
  post_url: string;
  post_urn?: string;
  author_name?: string;
  author_headline?: string;
  likes_count?: number;
  comments_count?: number;
  original_post_text?: string;
}

// ── Voyager Normalized Response Types ────────────────────────────────────────

interface VoyagerNormalizedResponse {
  data?: Record<string, unknown>;
  included?: VoyagerIncludedEntity[];
  elements?: VoyagerIncludedEntity[];
}

interface VoyagerIncludedEntity {
  $type?: string;
  entityUrn?: string;
  commentary?: string | { text?: string; textDirection?: string; $type?: string };
  actor?: string | { name?: { text?: string }; description?: { text?: string } };
  header?: { text?: { text?: string } };
  updateMetadata?: { urn?: string };
  socialDetail?: string;
  firstName?: string;
  lastName?: string;
  headline?: string;
  text?: string | { text?: string; textDirection?: string };
  numLikes?: number;
  numComments?: number;
  [key: string]: unknown;
}

// ── Resolve public_id to member URN ──────────────────────────────────────────

async function resolvePublicIdToMemberUrn(publicId: string): Promise<string> {
  // Search for the person to get their member URN
  const path =
    `/graphql?variables=(start:0,origin:FACETED_SEARCH,query:` +
    `(keywords:${encodeURIComponent(publicId)},flagshipSearchIntent:SEARCH_SRP,` +
    `queryParameters:List((key:resultType,value:List(PEOPLE))),includeFiltersInResponse:false))` +
    `&queryId=voyagerSearchDashClusters.b0928897b71bd00a5a7291755dcd64f0`;

  const response = await voyagerRequest<VoyagerNormalizedResponse>(path);

  for (const ent of response.included || []) {
    if ((ent.$type || "").includes("EntityResultViewModel")) {
      const urn = ent.entityUrn || "";
      const navUrl = (ent as Record<string, unknown>).navigationUrl as string || "";
      const entPublicId = navUrl.match(/\/in\/([^/?]+)/)?.[1] || "";

      // Match by public_id in navigation URL
      if (entPublicId === publicId || urn.includes(publicId)) {
        const match = urn.match(/fsd_profile:([^,)]+)/);
        if (match) {
          log("info", `Resolved ${publicId} → ${match[1]}`);
          return match[1];
        }
      }
    }
  }

  // If exact match not found, try first result (best guess from search)
  for (const ent of response.included || []) {
    if ((ent.$type || "").includes("EntityResultViewModel")) {
      const urn = ent.entityUrn || "";
      const match = urn.match(/fsd_profile:([^,)]+)/);
      if (match) {
        log("warn", `No exact match for ${publicId}, using first result: ${match[1]}`);
        return match[1];
      }
    }
  }

  throw new Error(`Could not resolve public_id "${publicId}" to member URN. Person may not exist or profile is private.`);
}

// ── Extract text from Voyager text objects ────────────────────────────────────

function extractText(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.text === "string") return obj.text;
    if (typeof obj.text === "object" && obj.text !== null) {
      return (obj.text as Record<string, unknown>).text as string || "";
    }
  }
  return "";
}

// ── Get Person Activity (Posts Feed) ─────────────────────────────────────────

export async function getPersonPosts(options: {
  public_id: string;
  count?: number;
  start?: number;
}): Promise<{ activities: PersonActivity[]; total: number }> {
  const count = Math.min(options.count || 10, 20);

  // Step 1: Resolve public_id to member URN
  let memberUrn: string;
  try {
    memberUrn = await resolvePublicIdToMemberUrn(options.public_id);
  } catch (err) {
    log("error", `Failed to resolve ${options.public_id}: ${(err as Error).message}`);
    return { activities: [], total: 0 };
  }

  // Step 2: Fetch activity feed
  const profileUrn = encodeURIComponent(`urn:li:fsd_profile:${memberUrn}`);
  const path = `/identity/profileUpdatesV2?q=memberShareFeed&profileUrn=${profileUrn}&count=${count}`;

  const response = await voyagerRequest<VoyagerNormalizedResponse>(path);
  const included = response.included || [];

  // Step 3: Build lookup maps for references
  const miniProfiles = new Map<string, { name: string; headline: string }>();
  const socialCounts = new Map<string, { likes: number; comments: number }>();

  for (const ent of included) {
    const type = ent.$type || "";
    const urn = ent.entityUrn || "";

    if (type.includes("MiniProfile") && ent.firstName) {
      miniProfiles.set(urn, {
        name: `${ent.firstName} ${ent.lastName || ""}`.trim(),
        headline: ent.headline || "",
      });
    }
    if (type.includes("SocialActivityCounts")) {
      socialCounts.set(urn, {
        likes: (ent.numLikes as number) || 0,
        comments: (ent.numComments as number) || 0,
      });
    }
  }

  // Step 4: Parse UpdateV2 entities into PersonActivity
  const activities: PersonActivity[] = [];

  for (const ent of included) {
    const type = ent.$type || "";
    if (!type.includes("UpdateV2")) continue;

    // Extract commentary text
    const commentaryText = extractText(ent.commentary);

    // Extract actor name
    let authorName = "";
    let authorHeadline = "";
    if (typeof ent.actor === "string") {
      const profile = miniProfiles.get(ent.actor);
      if (profile) {
        authorName = profile.name;
        authorHeadline = profile.headline;
      }
    } else if (ent.actor && typeof ent.actor === "object") {
      authorName = extractText((ent.actor as Record<string, unknown>).name);
    }

    // If no author from MiniProfile, try actor field as company/org name
    if (!authorName && typeof ent.actor === "string") {
      // Check miniCompany
      for (const ref of included) {
        if (ref.entityUrn === ent.actor && ref.$type?.includes("MiniCompany")) {
          authorName = (ref as Record<string, unknown>).name as string || "";
        }
      }
    }

    // Extract activity type from header
    const headerText = extractText(ent.header?.text);
    let activityType: PersonActivity["type"] = "post";
    if (headerText.toLowerCase().includes("commented")) activityType = "comment";
    else if (headerText.toLowerCase().includes("reposted")) activityType = "share";
    else if (headerText.toLowerCase().includes("liked") || headerText.toLowerCase().includes("loves")) activityType = "reaction";

    // Extract URN and build URL
    const activityUrn = ent.updateMetadata?.urn || ent.entityUrn || "";
    const postUrl = activityUrn
      ? `https://www.linkedin.com/feed/update/${activityUrn}`
      : "";

    // Get social counts
    const socialDetailRef = typeof ent.socialDetail === "string" ? ent.socialDetail : "";
    let counts = { likes: 0, comments: 0 };
    if (socialDetailRef) {
      // Look for matching SocialActivityCounts
      for (const ref of included) {
        if (ref.$type?.includes("SocialActivityCounts") && ref.entityUrn?.includes(socialDetailRef.split(":").pop() || "___")) {
          counts = { likes: (ref.numLikes as number) || 0, comments: (ref.numComments as number) || 0 };
        }
      }
    }

    // Only include if there's meaningful content
    if (commentaryText || headerText) {
      activities.push({
        type: activityType,
        text: commentaryText || headerText,
        date: "",  // profileUpdatesV2 doesn't return timestamps reliably
        post_url: postUrl,
        post_urn: activityUrn,
        author_name: authorName,
        author_headline: authorHeadline,
        likes_count: counts.likes,
        comments_count: counts.comments,
      });
    }
  }

  log("info", `Got ${activities.length} activities for ${options.public_id}`);
  return { activities: activities.slice(0, count), total: activities.length };
}

// ── Get Person Comments ──────────────────────────────────────────────────────

export async function getPersonComments(options: {
  public_id: string;
  count?: number;
  start?: number;
}): Promise<{ activities: PersonActivity[]; total: number }> {
  // Get all activity and filter to comments + shares (where they pitch)
  const all = await getPersonPosts(options);
  const comments = all.activities.filter(
    (a) => a.type === "comment" || a.type === "share"
  );

  // If no comments found, return all (salesy often pitch in their own posts too)
  if (comments.length === 0) {
    return all;
  }

  return {
    activities: comments,
    total: comments.length,
  };
}

// ── Extract public_id from LinkedIn URL ──────────────────────────────────────

export function extractPublicId(input: string): string {
  const match = input.match(/linkedin\.com\/in\/([^/?]+)/);
  if (match) return match[1];
  const navMatch = input.match(/linkedin\.com\/sales\/lead\/([^,/?]+)/);
  if (navMatch) return navMatch[1];
  return input.trim();
}
