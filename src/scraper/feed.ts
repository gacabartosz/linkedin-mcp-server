/**
 * LinkedIn Feed, Profile Detail, Notifications & Profile Viewers via Voyager API
 *
 * Provides access to the LinkedIn home feed, detailed profile information,
 * notification center, and "who viewed your profile" analytics.
 * Uses Voyager's normalized JSON format with data in `included[]`.
 */

import { voyagerRequest } from "./voyager.js";
import { log } from "../utils/logger.js";

// -- Types --------------------------------------------------------------------

export interface FeedPost {
  text: string;
  author_name: string;
  author_headline: string;
  author_public_id: string;
  post_urn: string;
  post_url: string;
  reactions_count: number;
  comments_count: number;
  shares_count: number;
  media: FeedMedia[];
}

export interface FeedMedia {
  type: string;
  url: string;
  title: string;
}

export interface ProfileDetail {
  name: string;
  headline: string;
  location: string;
  industry: string;
  about: string;
  profile_url: string;
  public_id: string;
  experience: ProfileExperience[];
  education: ProfileEducation[];
  skills: string[];
}

export interface ProfileExperience {
  title: string;
  company: string;
  location: string;
  date_range: string;
  description: string;
}

export interface ProfileEducation {
  school: string;
  degree: string;
  field: string;
  date_range: string;
}

export interface Notification {
  id: string;
  type: string;
  text: string;
  actor_name: string;
  timestamp: string;
  read: boolean;
}

export interface ProfileViewer {
  name: string;
  headline: string;
  company: string;
  view_date: string;
}

// -- Voyager Response Types ---------------------------------------------------

interface VoyagerNormalizedResponse {
  data?: Record<string, unknown>;
  included?: VoyagerIncludedEntity[];
  elements?: VoyagerIncludedEntity[];
  paging?: { count: number; start: number; total: number };
}

interface VoyagerIncludedEntity {
  $type?: string;
  entityUrn?: string;
  // Feed/Update fields
  commentary?: string | { text?: string };
  actor?: string | { name?: { text?: string }; description?: { text?: string } };
  header?: { text?: { text?: string } };
  updateMetadata?: { urn?: string };
  socialDetail?: string;
  content?: Record<string, unknown>;
  resharedUpdate?: string;
  // MiniProfile fields
  firstName?: string;
  lastName?: string;
  headline?: string;
  publicIdentifier?: string;
  objectUrn?: string;
  // Social counts
  numLikes?: number;
  numComments?: number;
  numShares?: number;
  // Profile fields
  locationName?: string;
  industryName?: string;
  summary?: string;
  geoLocationName?: string;
  // Experience
  title?: string | { text?: string };
  companyName?: string;
  locationName2?: string;
  timePeriod?: {
    startDate?: { year?: number; month?: number };
    endDate?: { year?: number; month?: number };
  };
  description?: string;
  // Education
  schoolName?: string;
  degreeName?: string;
  fieldOfStudy?: string;
  // Notification fields
  notificationType?: string;
  read?: boolean;
  createdAt?: number;
  // Viewer fields
  viewerName?: string;
  viewerHeadline?: string;
  viewerCompany?: string;
  viewDate?: number;
  [key: string]: unknown;
}

// -- Helper: extract text from Voyager text objects ---------------------------

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

// -- Helper: format date range from Voyager timePeriod ------------------------

function formatDateRange(timePeriod: VoyagerIncludedEntity["timePeriod"]): string {
  if (!timePeriod) return "";
  const start = timePeriod.startDate;
  const end = timePeriod.endDate;
  const startStr = start ? `${start.year || ""}${start.month ? `-${String(start.month).padStart(2, "0")}` : ""}` : "";
  const endStr = end ? `${end.year || ""}${end.month ? `-${String(end.month).padStart(2, "0")}` : ""}` : "Present";
  return startStr ? `${startStr} - ${endStr}` : "";
}

// -- Get Feed -----------------------------------------------------------------

/**
 * Fetch your LinkedIn home feed with recent posts.
 * @param count Number of feed items to return (max 25, default 10)
 * @returns Array of feed posts with engagement metrics
 */
export async function getFeed(count?: number): Promise<{
  posts: FeedPost[];
  total: number;
}> {
  const limit = Math.min(count || 10, 25);
  const path = `/feed/updatesV2?count=${limit}&q=relevance`;

  const response = await voyagerRequest<VoyagerNormalizedResponse>(path);
  const included = response.included || [];

  // Build MiniProfile lookup
  const miniProfiles = new Map<string, {
    name: string;
    headline: string;
    public_id: string;
  }>();

  for (const ent of included) {
    const type = ent.$type || "";
    if (type.includes("MiniProfile") && ent.firstName) {
      miniProfiles.set(ent.entityUrn || "", {
        name: `${ent.firstName} ${ent.lastName || ""}`.trim(),
        headline: ent.headline || "",
        public_id: ent.publicIdentifier || "",
      });
    }
  }

  // Build social counts lookup
  const socialCounts = new Map<string, {
    likes: number;
    comments: number;
    shares: number;
  }>();

  for (const ent of included) {
    const type = ent.$type || "";
    if (type.includes("SocialActivityCounts")) {
      socialCounts.set(ent.entityUrn || "", {
        likes: ent.numLikes || 0,
        comments: ent.numComments || 0,
        shares: ent.numShares || 0,
      });
    }
  }

  // Parse UpdateV2 entities into FeedPost
  const posts: FeedPost[] = [];

  for (const ent of included) {
    const type = ent.$type || "";
    if (!type.includes("UpdateV2")) continue;

    const commentaryText = extractText(ent.commentary);
    if (!commentaryText) continue; // Skip empty posts

    // Resolve author
    let authorName = "";
    let authorHeadline = "";
    let authorPublicId = "";

    if (typeof ent.actor === "string") {
      const profile = miniProfiles.get(ent.actor);
      if (profile) {
        authorName = profile.name;
        authorHeadline = profile.headline;
        authorPublicId = profile.public_id;
      }
    } else if (ent.actor && typeof ent.actor === "object") {
      authorName = extractText((ent.actor as Record<string, unknown>).name);
      authorHeadline = extractText((ent.actor as Record<string, unknown>).description);
    }

    // If no author from direct reference, search MiniProfiles in included
    if (!authorName) {
      for (const ref of included) {
        if (ref.$type?.includes("MiniCompany") || ref.$type?.includes("MiniProfile")) {
          const refUrn = ref.entityUrn || "";
          if (typeof ent.actor === "string" && refUrn === ent.actor) {
            authorName = (ref.firstName ? `${ref.firstName} ${ref.lastName || ""}`.trim() : "") ||
                         (ref as Record<string, unknown>).name as string || "";
            authorHeadline = ref.headline || "";
            authorPublicId = ref.publicIdentifier || "";
            break;
          }
        }
      }
    }

    // Extract URN and build URL
    const postUrn = ent.updateMetadata?.urn || ent.entityUrn || "";
    const postUrl = postUrn
      ? `https://www.linkedin.com/feed/update/${postUrn}`
      : "";

    // Get social counts
    let counts = { likes: 0, comments: 0, shares: 0 };
    const socialDetailRef = typeof ent.socialDetail === "string" ? ent.socialDetail : "";
    if (socialDetailRef) {
      for (const [urn, c] of socialCounts) {
        if (urn.includes(socialDetailRef.split(":").pop() || "___")) {
          counts = c;
          break;
        }
      }
    }

    // Extract media
    const media: FeedMedia[] = [];
    const contentObj = ent.content as Record<string, unknown> | undefined;
    if (contentObj) {
      const mediaType = contentObj.$type as string || "";
      if (mediaType.includes("Image") || mediaType.includes("image")) {
        media.push({
          type: "image",
          url: (contentObj.url as string) || "",
          title: extractText(contentObj.title),
        });
      } else if (mediaType.includes("Article") || mediaType.includes("article")) {
        media.push({
          type: "article",
          url: (contentObj.navigationUrl as string) || (contentObj.url as string) || "",
          title: extractText(contentObj.title),
        });
      } else if (mediaType.includes("Video") || mediaType.includes("video")) {
        media.push({
          type: "video",
          url: (contentObj.url as string) || "",
          title: extractText(contentObj.title),
        });
      }
    }

    posts.push({
      text: commentaryText,
      author_name: authorName,
      author_headline: authorHeadline,
      author_public_id: authorPublicId,
      post_urn: postUrn,
      post_url: postUrl,
      reactions_count: counts.likes,
      comments_count: counts.comments,
      shares_count: counts.shares,
      media,
    });
  }

  log("info", `Fetched ${posts.length} feed posts`);
  return { posts: posts.slice(0, limit), total: posts.length };
}

// -- Get Profile Detail -------------------------------------------------------

/**
 * Fetch detailed profile information for a LinkedIn user.
 * @param publicId LinkedIn public identifier (e.g., "bartoszgaca")
 * @returns Full profile with experience, education, and skills
 */
export async function getProfileDetail(publicId: string): Promise<ProfileDetail> {
  const path =
    `/identity/dash/profiles?q=memberIdentity&memberIdentity=${encodeURIComponent(publicId)}` +
    `&decorationId=com.linkedin.voyager.dash.deco.identity.profile.WebTopCardCore-21`;

  const response = await voyagerRequest<VoyagerNormalizedResponse>(path);
  const included = response.included || [];

  // Find main profile entity
  let name = "";
  let headline = "";
  let location = "";
  let industry = "";
  let about = "";

  for (const ent of included) {
    const type = ent.$type || "";

    // Profile entity
    if (type.includes("Profile") && !type.includes("Position") && !type.includes("Education")) {
      if (ent.firstName) {
        name = `${ent.firstName} ${ent.lastName || ""}`.trim();
        headline = ent.headline || "";
        location = (ent.locationName as string) || (ent.geoLocationName as string) || "";
        industry = (ent.industryName as string) || "";
        about = (ent.summary as string) || "";
      }
    }
  }

  // If no profile found via included, try fetching profile data from a simpler endpoint
  if (!name) {
    try {
      const simplePath = `/identity/profiles/${encodeURIComponent(publicId)}/profileView`;
      const simpleResponse = await voyagerRequest<VoyagerNormalizedResponse>(simplePath);
      const simpleIncluded = simpleResponse.included || [];

      for (const ent of simpleIncluded) {
        const type = ent.$type || "";
        if (type.includes("Profile") && ent.firstName) {
          name = `${ent.firstName} ${ent.lastName || ""}`.trim();
          headline = ent.headline || "";
          location = (ent.locationName as string) || (ent.geoLocationName as string) || "";
          industry = (ent.industryName as string) || "";
          about = (ent.summary as string) || "";
          // Merge in extra included entities for experience/education
          included.push(...simpleIncluded);
          break;
        }
      }
    } catch (err) {
      log("warn", `Fallback profile fetch failed for ${publicId}: ${(err as Error).message}`);
    }
  }

  if (!name) {
    throw new Error(`Profile not found for public_id "${publicId}". Person may not exist or profile is private.`);
  }

  // Parse experience
  const experience: ProfileExperience[] = [];
  for (const ent of included) {
    const type = ent.$type || "";
    if (!type.includes("Position")) continue;

    experience.push({
      title: extractText(ent.title),
      company: ent.companyName || "",
      location: (ent.locationName as string) || "",
      date_range: formatDateRange(ent.timePeriod),
      description: ent.description || "",
    });
  }

  // Parse education
  const education: ProfileEducation[] = [];
  for (const ent of included) {
    const type = ent.$type || "";
    if (!type.includes("Education")) continue;

    education.push({
      school: (ent.schoolName as string) || "",
      degree: (ent.degreeName as string) || "",
      field: (ent.fieldOfStudy as string) || "",
      date_range: formatDateRange(ent.timePeriod),
    });
  }

  // Parse skills (if present in included)
  const skills: string[] = [];
  for (const ent of included) {
    const type = ent.$type || "";
    if (!type.includes("Skill")) continue;
    const skillName = (ent.name as string) || extractText(ent.title);
    if (skillName) skills.push(skillName);
  }

  const result: ProfileDetail = {
    name,
    headline,
    location,
    industry,
    about,
    profile_url: `https://www.linkedin.com/in/${publicId}`,
    public_id: publicId,
    experience,
    education,
    skills,
  };

  log("info", `Fetched profile detail for ${publicId}: ${name}, ${experience.length} positions, ${education.length} schools`);
  return result;
}

// -- Get Notifications --------------------------------------------------------

/**
 * Fetch LinkedIn notifications from the notification center.
 * @param count Number of notifications to return (max 50, default 20)
 * @returns Array of notifications with type, text, and read status
 */
export async function getNotifications(count?: number): Promise<{
  notifications: Notification[];
  total: number;
}> {
  const limit = Math.min(count || 20, 50);

  // Try new notification cards endpoint (2025+ LinkedIn)
  let response: VoyagerNormalizedResponse;
  try {
    response = await voyagerRequest<VoyagerNormalizedResponse>(
      `/voyagerIdentityDashNotificationCards?decorationId=com.linkedin.voyager.dash.deco.identity.notifications.CardsCollectionWithInjectionsNoPills-24&count=${limit}`
    );
  } catch {
    try {
      response = await voyagerRequest<VoyagerNormalizedResponse>(
        `/identity/notifications?count=${limit}`
      );
    } catch (err: any) {
      log("error", `Notifications fetch failed: ${err.message}`);
      return { notifications: [], total: 0 };
    }
  }
  const included = response.included || [];

  // Build MiniProfile lookup
  const miniProfiles = new Map<string, string>();
  for (const ent of included) {
    const type = ent.$type || "";
    if (type.includes("MiniProfile") && ent.firstName) {
      miniProfiles.set(
        ent.entityUrn || "",
        `${ent.firstName} ${ent.lastName || ""}`.trim(),
      );
    }
  }

  // Parse notification entities
  const notifications: Notification[] = [];

  for (const ent of included) {
    const type = ent.$type || "";
    if (!type.includes("Notification") && !type.includes("notification")) continue;
    if (type.includes("MiniProfile")) continue;

    const notificationUrn = ent.entityUrn || "";
    const notificationId = notificationUrn.split(":").pop() || notificationUrn;

    // Extract notification text from various possible fields
    const text =
      extractText(ent.headline) ||
      extractText(ent.header?.text) ||
      extractText(ent.title) ||
      (ent.message as string) || "";

    if (!text) continue;

    // Resolve actor name
    let actorName = "";
    const actorRef = (ent.actor as string) || (ent.actorUrn as string) || "";
    if (actorRef && miniProfiles.has(actorRef)) {
      actorName = miniProfiles.get(actorRef) || "";
    }

    const timestamp = ent.createdAt
      ? new Date(ent.createdAt).toISOString()
      : "";

    notifications.push({
      id: notificationId,
      type: ent.notificationType || (ent.notificationTypeUrn as string) || "unknown",
      text,
      actor_name: actorName,
      timestamp,
      read: ent.read === true,
    });
  }

  log("info", `Fetched ${notifications.length} notifications`);
  return { notifications, total: notifications.length };
}

// -- Get Who Viewed Your Profile ----------------------------------------------

/**
 * Fetch "who viewed your profile" analytics with viewer details.
 * @param count Number of viewers to return (max 50, default 20)
 * @returns Array of viewers with name, headline, company, and view date
 */
export async function getWhoViewed(count?: number): Promise<{
  viewers: ProfileViewer[];
  total: number;
}> {
  const limit = Math.min(count || 20, 50);
  const path = `/identity/wvmpCards?count=${limit}`;

  const response = await voyagerRequest<VoyagerNormalizedResponse>(path);
  const included = response.included || [];

  // Build MiniProfile lookup
  const miniProfiles = new Map<string, {
    name: string;
    headline: string;
  }>();

  for (const ent of included) {
    const type = ent.$type || "";
    if (type.includes("MiniProfile") && ent.firstName) {
      miniProfiles.set(ent.entityUrn || "", {
        name: `${ent.firstName} ${ent.lastName || ""}`.trim(),
        headline: ent.headline || "",
      });
    }
  }

  // Parse viewer cards
  const viewers: ProfileViewer[] = [];

  for (const ent of included) {
    const type = ent.$type || "";
    if (!type.includes("wvmp") && !type.includes("Wvmp") && !type.includes("ViewerCard") && !type.includes("viewer")) {
      continue;
    }
    if (type.includes("MiniProfile")) continue;

    // Try named fields first
    let name = (ent.viewerName as string) || extractText(ent.title);
    let headline = (ent.viewerHeadline as string) || extractText(ent.subtitle);
    let company = (ent.viewerCompany as string) || "";

    // Try to resolve from MiniProfile reference
    if (!name) {
      const profileRef = (ent.profile as string) || (ent.member as string) || "";
      const profile = miniProfiles.get(profileRef);
      if (profile) {
        name = profile.name;
        headline = headline || profile.headline;
      }
    }

    // Extract company from headline if not set
    if (!company && headline) {
      const atMatch = headline.match(/\bat\s+(.+)/i);
      if (atMatch) company = atMatch[1].trim();
    }

    const viewDate = ent.viewDate
      ? new Date(ent.viewDate).toISOString()
      : ent.createdAt
        ? new Date(ent.createdAt).toISOString()
        : "";

    if (name || headline) {
      viewers.push({
        name: name || "Anonymous LinkedIn Member",
        headline,
        company,
        view_date: viewDate,
      });
    }
  }

  log("info", `Fetched ${viewers.length} profile viewers`);
  return { viewers, total: viewers.length };
}
