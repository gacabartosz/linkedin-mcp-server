/**
 * LinkedIn Member Creator Post Analytics API
 * Requires scope: r_member_postAnalytics
 * Provides: impressions, members reached, reshares, reactions, comments
 *
 * Docs: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/members/post-statistics
 */

import { linkedinRequest } from "./client.js";
import { log } from "../utils/logger.js";

export type MetricType = "IMPRESSION" | "MEMBERS_REACHED" | "RESHARE" | "REACTION" | "COMMENT";
export type Aggregation = "DAILY" | "TOTAL";

interface DatePart {
  year: number;
  month: number;
  day: number;
}

interface AnalyticsElement {
  count: number;
  metricType: { [key: string]: MetricType } | MetricType;
  targetEntity?: { share?: string; ugcPost?: string };
  dateRange?: { start: DatePart; end: DatePart };
}

interface AnalyticsResponse {
  elements: AnalyticsElement[];
  paging?: { count: number; start: number };
}

function extractMetricType(mt: AnalyticsElement["metricType"]): string {
  if (typeof mt === "string") return mt;
  return Object.values(mt)[0] || "UNKNOWN";
}

export interface PostAnalytics {
  post_urn: string;
  metric_type: string;
  count: number;
  date?: string; // YYYY-MM-DD for DAILY, undefined for TOTAL
}

export interface AggregatedAnalytics {
  metric_type: string;
  data_points: Array<{ date: string; count: number }>;
  total: number;
}

/**
 * Get analytics for a single post.
 * Each call returns ONE metric type. Call multiple times for full picture.
 */
export async function getPostAnalytics(
  postUrn: string,
  queryType: MetricType,
  aggregation: Aggregation = "TOTAL",
  dateRange?: { start: Date; end: Date },
): Promise<PostAnalytics[]> {
  // Determine URN type for entity parameter
  const isShare = postUrn.includes("share:");
  const urnType = isShare ? "share" : "ugc";
  const encodedUrn = encodeURIComponent(postUrn);
  const entityParam = `(${urnType}:${encodedUrn})`;

  let path = `/memberCreatorPostAnalytics?q=entity&entity=${entityParam}&queryType=${queryType}&aggregation=${aggregation}`;

  if (dateRange) {
    const s = dateRange.start;
    const e = dateRange.end;
    path += `&dateRange=(start:(day:${s.getDate()},month:${s.getMonth() + 1},year:${s.getFullYear()}),end:(day:${e.getDate()},month:${e.getMonth() + 1},year:${e.getFullYear()}))`;
  }

  const raw = await linkedinRequest<AnalyticsResponse>("GET", path);

  const results: PostAnalytics[] = [];
  for (const el of raw.elements || []) {
    const dateStr = el.dateRange?.start
      ? `${el.dateRange.start.year}-${String(el.dateRange.start.month).padStart(2, "0")}-${String(el.dateRange.start.day).padStart(2, "0")}`
      : undefined;
    results.push({
      post_urn: postUrn,
      metric_type: extractMetricType(el.metricType),
      count: el.count,
      date: dateStr,
    });
  }

  log("info", `Post analytics ${queryType}/${aggregation} for ${postUrn}: ${results.length} data points`);
  return results;
}

/**
 * Get ALL metrics for a single post (impressions, reach, reshares, reactions, comments).
 */
export async function getPostFullAnalytics(postUrn: string): Promise<Record<string, number>> {
  const metrics: MetricType[] = ["IMPRESSION", "MEMBERS_REACHED", "RESHARE", "REACTION", "COMMENT"];
  const result: Record<string, number> = {};

  for (const metric of metrics) {
    try {
      const data = await getPostAnalytics(postUrn, metric, "TOTAL");
      result[metric.toLowerCase()] = data[0]?.count || 0;
    } catch (err) {
      log("warn", `Failed to get ${metric} for ${postUrn}: ${err}`);
      result[metric.toLowerCase()] = 0;
    }
  }

  return result;
}

/**
 * Get aggregated analytics for ALL member posts (the q=me finder).
 * Returns daily data points for the specified metric.
 */
export async function getAggregatedAnalytics(
  queryType: MetricType,
  aggregation: Aggregation = "DAILY",
  dateRange?: { start: Date; end: Date },
): Promise<AggregatedAnalytics> {
  let path = `/memberCreatorPostAnalytics?q=me&queryType=${queryType}&aggregation=${aggregation}`;

  if (dateRange) {
    const s = dateRange.start;
    const e = dateRange.end;
    path += `&dateRange=(start:(day:${s.getDate()},month:${s.getMonth() + 1},year:${s.getFullYear()}),end:(day:${e.getDate()},month:${e.getMonth() + 1},year:${e.getFullYear()}))`;
  }

  const raw = await linkedinRequest<AnalyticsResponse>("GET", path);

  let total = 0;
  const dataPoints: Array<{ date: string; count: number }> = [];

  for (const el of raw.elements || []) {
    total += el.count;
    const dateStr = el.dateRange?.start
      ? `${el.dateRange.start.year}-${String(el.dateRange.start.month).padStart(2, "0")}-${String(el.dateRange.start.day).padStart(2, "0")}`
      : "total";
    dataPoints.push({ date: dateStr, count: el.count });
  }

  log("info", `Aggregated analytics ${queryType}/${aggregation}: ${dataPoints.length} data points, total: ${total}`);
  return { metric_type: queryType, data_points: dataPoints, total };
}
