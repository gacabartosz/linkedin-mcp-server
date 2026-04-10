/**
 * LinkedIn Social Metadata API
 * Retrieves reaction breakdown and comment counts for posts.
 * Uses existing w_member_social scope — no new permissions needed.
 */

import { linkedinRequest } from "./client.js";
import { log } from "../utils/logger.js";

export interface ReactionSummary {
  reactionType: string;
  count: number;
}

export interface SocialMetadata {
  entity: string;
  commentsState: string;
  commentSummary: { count: number; topLevelCount: number };
  reactionSummaries: Record<string, ReactionSummary>;
}

export interface PostMetrics {
  post_urn: string;
  reactions: Record<string, number>;
  total_reactions: number;
  comments: number;
  comments_top_level: number;
  comments_state: string;
}

function parseSocialMetadata(raw: SocialMetadata): PostMetrics {
  const reactions: Record<string, number> = {};
  let total = 0;
  for (const [type, summary] of Object.entries(raw.reactionSummaries || {})) {
    reactions[type] = summary.count;
    total += summary.count;
  }
  return {
    post_urn: raw.entity || "",
    reactions,
    total_reactions: total,
    comments: raw.commentSummary?.count || 0,
    comments_top_level: raw.commentSummary?.topLevelCount || 0,
    comments_state: raw.commentsState || "UNKNOWN",
  };
}

/**
 * Get social metadata (reactions + comments) for a single post.
 */
export async function getPostMetrics(postUrn: string): Promise<PostMetrics> {
  const encoded = encodeURIComponent(postUrn);
  const raw = await linkedinRequest<SocialMetadata>("GET", `/socialMetadata/${encoded}`);
  const metrics = parseSocialMetadata(raw);
  metrics.post_urn = postUrn;
  log("info", `Post metrics for ${postUrn}: ${metrics.total_reactions} reactions, ${metrics.comments} comments`);
  return metrics;
}

/**
 * Batch get social metadata for up to 20 posts at once.
 * Falls back to per-post fetching if batch endpoint returns 403 (deprecated scope).
 */
export async function getPostMetricsBatch(postUrns: string[]): Promise<PostMetrics[]> {
  if (postUrns.length === 0) return [];
  const batch = postUrns.slice(0, 20);

  // Try batch endpoint first
  try {
    const ids = batch.map(u => encodeURIComponent(u)).join(",");
    const raw = await linkedinRequest<{ results?: Record<string, SocialMetadata>; statuses?: Record<string, number> }>(
      "GET",
      `/socialMetadata?ids=List(${ids})`,
    );

    const results: PostMetrics[] = [];
    for (const urn of batch) {
      const data = raw.results?.[urn];
      if (data) {
        const metrics = parseSocialMetadata(data);
        metrics.post_urn = urn;
        results.push(metrics);
      }
    }
    log("info", `Batch metrics: ${results.length}/${batch.length} posts returned`);
    return results;
  } catch (err: any) {
    if (err.message?.includes("403") || err.message?.includes("permissions")) {
      log("warn", `Batch endpoint rejected (403), falling back to per-post fetch for ${batch.length} posts`);
    } else {
      log("warn", `Batch endpoint failed: ${err.message}, falling back to per-post`);
    }
  }

  // Fallback: fetch one by one (slower but works with w_member_social scope)
  const results: PostMetrics[] = [];
  for (const urn of batch) {
    try {
      const metrics = await getPostMetrics(urn);
      results.push(metrics);
    } catch (err: any) {
      log("warn", `Per-post metrics failed for ${urn}: ${err.message}`);
    }
  }
  log("info", `Per-post metrics: ${results.length}/${batch.length} posts fetched`);
  return results;
}

export interface ReactorDetail {
  person_urn: string;
  reaction_type: string;
  created_at: number;
}

/**
 * Get detailed list of who reacted to a post (with reaction type + timestamp).
 */
export async function getPostReactors(postUrn: string, count = 50): Promise<{
  reactors: ReactorDetail[];
  total: number;
}> {
  const encoded = encodeURIComponent(postUrn);
  const raw = await linkedinRequest<{
    elements?: Array<{
      id?: string;
      reactionType?: string;
      created?: { actor?: string; time?: number };
    }>;
    paging?: { total?: number };
  }>("GET", `/reactions/(entity:${encoded})?q=entity&sort=(value:REVERSE_CHRONOLOGICAL)&count=${count}`);

  const reactors: ReactorDetail[] = [];
  for (const el of raw.elements || []) {
    reactors.push({
      person_urn: el.created?.actor || "",
      reaction_type: el.reactionType || "LIKE",
      created_at: el.created?.time || 0,
    });
  }

  return {
    reactors,
    total: raw.paging?.total || reactors.length,
  };
}
