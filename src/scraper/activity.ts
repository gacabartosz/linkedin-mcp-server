/**
 * LinkedIn Person Activity Monitor via Voyager API
 *
 * Fetches posts, comments, and reactions for a given person.
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
  original_post_text?: string; // For comments: the post being commented on
}

// ── Voyager Activity Response Types ──────────────────────────────────────────

interface VoyagerActivityResponse {
  data?: {
    identityDashProfileUpdatesByMemberShareFeed?: {
      elements?: VoyagerActivityElement[];
      paging?: { count: number; start: number; total: number };
    };
  };
  included?: VoyagerIncludedEntity[];
}

interface VoyagerActivityElement {
  actor?: {
    name?: { text?: string };
    description?: { text?: string };
  };
  commentary?: { text?: string };
  content?: Record<string, unknown>;
  socialDetail?: {
    totalSocialActivityCounts?: {
      numLikes?: number;
      numComments?: number;
      numShares?: number;
    };
    urn?: string;
  };
  dashEntityUrn?: string;
  entityUrn?: string;
  header?: { text?: { text?: string } };
  createdAt?: number;
  resharedUpdate?: VoyagerActivityElement;
  $type?: string;
}

interface VoyagerIncludedEntity {
  $type?: string;
  entityUrn?: string;
  commentary?: { text?: string };
  actor?: { name?: { text?: string }; description?: { text?: string } };
  socialDetail?: Record<string, unknown>;
  createdAt?: number;
  [key: string]: unknown;
}

// ── Voyager Comments Feed Response ───────────────────────────────────────────

interface VoyagerCommentsFeedResponse {
  elements?: VoyagerCommentFeedItem[];
  paging?: { count: number; start: number; total: number };
  included?: VoyagerIncludedEntity[];
}

interface VoyagerCommentFeedItem {
  commentary?: { text?: string };
  originalActivity?: { commentary?: { text?: string } };
  createdAt?: number;
  entityUrn?: string;
  actor?: {
    name?: { text?: string };
    description?: { text?: string };
  };
  $type?: string;
  [key: string]: unknown;
}

// ── Get Person Activity (Posts Feed) ─────────────────────────────────────────

export async function getPersonPosts(options: {
  public_id: string;
  count?: number;
  start?: number;
}): Promise<{ activities: PersonActivity[]; total: number }> {
  const count = Math.min(options.count || 10, 20);
  const start = options.start || 0;

  // The Voyager API for member activity uses the profileUpdates endpoint
  const path =
    `/identity/profileUpdatesV2?q=memberShareFeed` +
    `&profileUrn=urn:li:fsd_profile:${encodeURIComponent(options.public_id)}` +
    `&count=${count}&start=${start}`;

  let response: VoyagerActivityResponse;
  try {
    response = await voyagerRequest<VoyagerActivityResponse>(path);
  } catch (err) {
    // Fallback: try with the graphql endpoint
    log("warn", `Direct activity fetch failed, trying alternative endpoint`);
    return getPersonActivityGraphQL(options);
  }

  const activities: PersonActivity[] = [];
  const elements = response.data?.identityDashProfileUpdatesByMemberShareFeed?.elements ||
                   (response as Record<string, unknown>).elements as VoyagerActivityElement[] || [];

  for (const el of elements) {
    const text = el.commentary?.text || "";
    const header = el.header?.text?.text || "";
    const createdAt = el.createdAt ? new Date(el.createdAt).toISOString() : "";
    const urn = el.dashEntityUrn || el.entityUrn || "";
    const counts = el.socialDetail?.totalSocialActivityCounts;

    let type: PersonActivity["type"] = "post";
    if (header.toLowerCase().includes("commented")) type = "comment";
    else if (header.toLowerCase().includes("reposted") || el.resharedUpdate) type = "share";
    else if (header.toLowerCase().includes("liked") || header.toLowerCase().includes("reaction")) type = "reaction";

    const postUrl = urn
      ? `https://www.linkedin.com/feed/update/${urn.replace(/^urn:li:/, "urn:li:")}`
      : "";

    activities.push({
      type,
      text: text || header,
      date: createdAt,
      post_url: postUrl,
      post_urn: urn,
      author_name: el.actor?.name?.text,
      author_headline: el.actor?.description?.text,
      likes_count: counts?.numLikes,
      comments_count: counts?.numComments,
      original_post_text: el.resharedUpdate?.commentary?.text,
    });
  }

  const total = response.data?.identityDashProfileUpdatesByMemberShareFeed?.paging?.total || activities.length;
  log("info", `Got ${activities.length} activities for ${options.public_id}`);

  return { activities, total };
}

// ── Alternative: GraphQL endpoint for activity ───────────────────────────────

async function getPersonActivityGraphQL(options: {
  public_id: string;
  count?: number;
  start?: number;
}): Promise<{ activities: PersonActivity[]; total: number }> {
  const count = Math.min(options.count || 10, 20);
  const start = options.start || 0;

  const path =
    `/feed/dash/feedCardsByMemberActivity` +
    `?profileUrn=urn:li:fsd_profile:${encodeURIComponent(options.public_id)}` +
    `&q=MEMBER_ACTIVITY&count=${count}&start=${start}`;

  const response = await voyagerRequest<VoyagerCommentsFeedResponse>(path);

  const activities: PersonActivity[] = [];
  const elements = response.elements || [];

  for (const el of elements) {
    const text = el.commentary?.text || "";
    const createdAt = el.createdAt ? new Date(el.createdAt).toISOString() : "";
    const urn = el.entityUrn || "";

    activities.push({
      type: "post",
      text,
      date: createdAt,
      post_url: urn ? `https://www.linkedin.com/feed/update/${urn}` : "",
      post_urn: urn,
      author_name: el.actor?.name?.text,
      author_headline: el.actor?.description?.text,
      original_post_text: el.originalActivity?.commentary?.text,
    });
  }

  const total = response.paging?.total || activities.length;
  return { activities, total };
}

// ── Get Person Comments (what they commented on) ─────────────────────────────

export async function getPersonComments(options: {
  public_id: string;
  count?: number;
  start?: number;
}): Promise<{ activities: PersonActivity[]; total: number }> {
  const count = Math.min(options.count || 10, 20);
  const start = options.start || 0;

  // Comments feed endpoint
  const path =
    `/identity/profileUpdatesV2?q=memberShareFeed` +
    `&profileUrn=urn:li:fsd_profile:${encodeURIComponent(options.public_id)}` +
    `&moduleKey=member_share_feed&count=${count}&start=${start}` +
    `&activityFilter=COMMENTS`;

  let response: VoyagerActivityResponse;
  try {
    response = await voyagerRequest<VoyagerActivityResponse>(path);
  } catch {
    log("warn", "Comments filter not supported, falling back to all activity");
    // Fallback: get all activity and filter comments client-side
    const all = await getPersonPosts(options);
    return {
      activities: all.activities.filter((a) => a.type === "comment"),
      total: all.activities.filter((a) => a.type === "comment").length,
    };
  }

  const activities: PersonActivity[] = [];
  const elements = response.data?.identityDashProfileUpdatesByMemberShareFeed?.elements ||
                   (response as Record<string, unknown>).elements as VoyagerActivityElement[] || [];

  for (const el of elements) {
    const text = el.commentary?.text || "";
    const createdAt = el.createdAt ? new Date(el.createdAt).toISOString() : "";
    const urn = el.dashEntityUrn || el.entityUrn || "";

    activities.push({
      type: "comment",
      text,
      date: createdAt,
      post_url: urn ? `https://www.linkedin.com/feed/update/${urn}` : "",
      post_urn: urn,
      author_name: el.actor?.name?.text,
      author_headline: el.actor?.description?.text,
      original_post_text: el.resharedUpdate?.commentary?.text,
    });
  }

  const total = response.data?.identityDashProfileUpdatesByMemberShareFeed?.paging?.total || activities.length;
  log("info", `Got ${activities.length} comments for ${options.public_id}`);

  return { activities, total };
}

// ── Extract public_id from LinkedIn URL ──────────────────────────────────────

export function extractPublicId(input: string): string {
  // Handle: https://www.linkedin.com/in/bartoszgaca/
  const match = input.match(/linkedin\.com\/in\/([^/?]+)/);
  if (match) return match[1];
  // Handle Sales Navigator: https://www.linkedin.com/sales/lead/...
  const navMatch = input.match(/linkedin\.com\/sales\/lead\/([^,/?]+)/);
  if (navMatch) return navMatch[1];
  // Raw public_id
  return input.trim();
}
