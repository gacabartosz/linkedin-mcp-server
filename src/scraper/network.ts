/**
 * LinkedIn Voyager API — Network Stats & Profile Views
 * Uses li_at session cookie for internal API access.
 *
 * Updated: uses /dash/ endpoints (legacy /identity/profiles/ deprecated → 410)
 */

import { voyagerRequest } from "./voyager.js";
import { log } from "../utils/logger.js";

export interface NetworkInfo {
  follower_count: number;
  connection_count: number;
  following_count: number;
}

/**
 * Get network info (follower count, connections) for a profile.
 * Tries dash endpoint first, falls back to legacy.
 */
export async function getNetworkInfo(publicId: string): Promise<NetworkInfo> {
  // Use TopCardSupplementary-137 decoration which includes FollowingState with followerCount
  try {
    const path = `/identity/dash/profiles?q=memberIdentity&memberIdentity=${encodeURIComponent(publicId)}&decorationId=com.linkedin.voyager.dash.deco.identity.profile.TopCardSupplementary-137`;
    const raw = await voyagerRequest<any>(path);

    const result: NetworkInfo = {
      follower_count: 0,
      connection_count: 0,
      following_count: 0,
    };

    // Extract followerCount from FollowingState in included[]
    for (const inc of raw?.included || []) {
      const type = inc.$type || "";
      if (type.includes("FollowingState") && inc.followerCount !== undefined) {
        result.follower_count = inc.followerCount;
        result.following_count = inc.following ? 1 : 0; // boolean
      }
      if (type.includes("Connection") && inc.connectionCount !== undefined) {
        result.connection_count = inc.connectionCount;
      }
    }

    if (result.follower_count > 0) {
      log("info", `Network info for ${publicId}: ${result.follower_count} followers, ${result.connection_count} connections`);
      return result;
    }
  } catch (err: any) {
    log("warn", `Dash network endpoint failed: ${err.message}`);
  }

  // Fallback: return zeros (legacy endpoints are deprecated 410)
  log("error", `All network info endpoints failed for ${publicId}`);
  return { follower_count: 0, connection_count: 0, following_count: 0 };
}

export interface ProfileViewData {
  total_views: number;
  data_points: Array<{ date: string; views: number }>;
}

/**
 * Get profile view statistics.
 * Tries multiple endpoints.
 */
export async function getProfileViews(publicId: string): Promise<ProfileViewData> {
  // Try the analytics dashboard endpoint
  try {
    const path = `/identity/profileAnalyticsDashboards?q=profile&profileUrn=urn:li:fsd_profile:${encodeURIComponent(publicId)}&type=PROFILE_VIEWS`;
    const raw = await voyagerRequest<any>(path);

    const elements = raw?.elements?.[0]?.timeSeriesData?.elements || [];
    const dataPoints: Array<{ date: string; views: number }> = [];
    let total = 0;

    for (const el of elements) {
      if (el.date || el.startDate) {
        const dateObj = el.date || el.startDate;
        const d = `${dateObj.year}-${String(dateObj.month || 1).padStart(2, "0")}-${String(dateObj.day || 1).padStart(2, "0")}`;
        const views = el.count || el.value || 0;
        dataPoints.push({ date: d, views });
        total += views;
      }
    }

    if (dataPoints.length > 0) {
      log("info", `Profile views (analytics) for ${publicId}: ${total} total, ${dataPoints.length} data points`);
      return { total_views: total, data_points: dataPoints };
    }
  } catch (err: any) {
    log("warn", `Analytics dashboard endpoint failed: ${err.message}`);
  }

  // Try legacy profileView endpoint
  try {
    const path = `/identity/profiles/${encodeURIComponent(publicId)}/profileView`;
    const raw = await voyagerRequest<any>(path);

    const dataPoints: Array<{ date: string; views: number }> = [];
    for (const el of raw.profileViewTimeline?.elements || []) {
      if (el.date) {
        const d = `${el.date.year}-${String(el.date.month || 1).padStart(2, "0")}-${String(el.date.day || 1).padStart(2, "0")}`;
        dataPoints.push({ date: d, views: el.viewCount || 0 });
      }
    }

    const result: ProfileViewData = {
      total_views: raw.views || dataPoints.reduce((sum, dp) => sum + dp.views, 0),
      data_points: dataPoints,
    };

    log("info", `Profile views (legacy) for ${publicId}: ${result.total_views} total`);
    return result;
  } catch (err: any) {
    log("warn", `Legacy profileView also failed: ${err.message}`);
    return { total_views: 0, data_points: [] };
  }
}
