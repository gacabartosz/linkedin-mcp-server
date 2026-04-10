/**
 * LinkedIn Invitations & Connections via Voyager API
 *
 * Provides sending/receiving connection requests, managing pending
 * invitations, and listing existing connections.
 * Uses the growth and relationships Voyager endpoints.
 */

import { voyagerRequest } from "./voyager.js";
import { log } from "../utils/logger.js";

// -- Types --------------------------------------------------------------------

export interface Invitation {
  id: string;
  invitation_urn: string;
  sender_name: string;
  sender_headline: string;
  sender_public_id: string;
  message: string;
  sent_at: string;
  invitation_type: "received" | "sent";
}

export interface Connection {
  name: string;
  headline: string;
  public_id: string;
  profile_urn: string;
  connected_at: string;
}

// -- Voyager Response Types ---------------------------------------------------

interface VoyagerInvitationResponse {
  data?: Record<string, unknown>;
  included?: VoyagerInvitationEntity[];
  elements?: VoyagerInvitationEntity[];
}

interface VoyagerInvitationEntity {
  $type?: string;
  entityUrn?: string;
  // Invitation fields
  invitation?: string | Record<string, unknown>;
  subtitle?: string | { text?: string };
  title?: string | { text?: string };
  message?: string;
  sentTime?: number;
  invitationType?: string;
  // MiniProfile fields
  firstName?: string;
  lastName?: string;
  headline?: string;
  publicIdentifier?: string;
  objectUrn?: string;
  // Connection fields
  connectedMember?: string;
  createdAt?: number;
  [key: string]: unknown;
}

interface VoyagerConnectionsResponse {
  data?: Record<string, unknown>;
  included?: VoyagerInvitationEntity[];
  elements?: VoyagerInvitationEntity[];
  paging?: { count: number; start: number; total: number };
}

// -- Helper: extract text from Voyager text objects ---------------------------

function extractText(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.text === "string") return obj.text;
  }
  return "";
}

// -- Helper: resolve publicId to profile URN ----------------------------------

async function resolvePublicIdToProfileUrn(publicId: string): Promise<string> {
  const path =
    `/graphql?variables=(start:0,origin:FACETED_SEARCH,query:` +
    `(keywords:${encodeURIComponent(publicId)},flagshipSearchIntent:SEARCH_SRP,` +
    `queryParameters:List((key:resultType,value:List(PEOPLE))),includeFiltersInResponse:false))` +
    `&queryId=voyagerSearchDashClusters.b0928897b71bd00a5a7291755dcd64f0`;

  const response = await voyagerRequest<{
    included?: Array<{
      $type?: string;
      entityUrn?: string;
      navigationUrl?: string;
      [key: string]: unknown;
    }>;
  }>(path);

  for (const ent of response.included || []) {
    if (!(ent.$type || "").includes("EntityResultViewModel")) continue;

    const navUrl = (ent.navigationUrl as string) || "";
    const entPublicId = navUrl.match(/\/in\/([^/?]+)/)?.[1] || "";

    if (entPublicId === publicId) {
      const urn = ent.entityUrn || "";
      const match = urn.match(/fsd_profile:([^,)]+)/);
      if (match) {
        log("info", `Resolved ${publicId} -> urn:li:fsd_profile:${match[1]}`);
        return `urn:li:fsd_profile:${match[1]}`;
      }
    }
  }

  // Fallback: use first result
  for (const ent of response.included || []) {
    if (!(ent.$type || "").includes("EntityResultViewModel")) continue;
    const urn = ent.entityUrn || "";
    const match = urn.match(/fsd_profile:([^,)]+)/);
    if (match) {
      log("warn", `No exact match for ${publicId}, using first result`);
      return `urn:li:fsd_profile:${match[1]}`;
    }
  }

  throw new Error(
    `Could not resolve public_id "${publicId}" to profile URN. ` +
    `Person may not exist or profile is private.`
  );
}

// -- Send Invitation ----------------------------------------------------------

/**
 * Send a connection request to a LinkedIn user.
 * Resolves the publicId to a profile URN via search, then sends the invitation.
 * @param publicId LinkedIn public identifier (e.g., "bartoszgaca")
 * @param message Optional personalized message (max 300 chars on LinkedIn)
 * @returns Success status
 */
export async function sendInvitation(
  publicId: string,
  message?: string,
): Promise<{ success: boolean; profile_urn: string }> {
  if (message && message.length > 300) {
    throw new Error("Invitation message cannot exceed 300 characters (LinkedIn limit)");
  }

  // Step 1: Resolve publicId to profile URN
  const profileUrn = await resolvePublicIdToProfileUrn(publicId);

  // Step 2: Send the invitation
  const path = `/growth/normInvitations`;

  const body: Record<string, unknown> = {
    inviteeProfileUrn: profileUrn,
  };
  if (message) {
    body.message = message;
  }

  await voyagerRequest<Record<string, unknown>>(path, { method: "POST", body });

  log("info", `Sent connection request to ${publicId} (${profileUrn})`);
  return { success: true, profile_urn: profileUrn };
}

// -- Get Invitations ----------------------------------------------------------

/**
 * List pending invitations (received or sent).
 * @param type Whether to list received or sent invitations
 * @param count Number of invitations to return (max 100, default 50)
 * @returns Array of pending invitations
 */
export async function getInvitations(
  type: "received" | "sent",
  count?: number,
): Promise<{ invitations: Invitation[]; total: number }> {
  const limit = Math.min(count || 50, 100);
  const invitationType = type === "received" ? "RECEIVED" : "SENT";

  let response: VoyagerInvitationResponse;
  try {
    response = await voyagerRequest<VoyagerInvitationResponse>(
      `/relationships/invitationViews?includeInsights=true&count=${limit}&invitationType=${invitationType}`
    );
  } catch {
    try {
      response = await voyagerRequest<VoyagerInvitationResponse>(
        `/relationships/invitationViews?count=${limit}&invitationType=${invitationType}`
      );
    } catch (err: any) {
      log("error", `Invitations fetch failed: ${err.message}`);
      return { invitations: [], total: 0 };
    }
  }
  const included = response.included || [];

  // Build MiniProfile lookup
  const miniProfiles = new Map<string, {
    name: string;
    headline: string;
    public_id: string;
  }>();

  for (const ent of included) {
    const entType = ent.$type || "";
    if (entType.includes("MiniProfile") && ent.firstName) {
      miniProfiles.set(ent.entityUrn || "", {
        name: `${ent.firstName} ${ent.lastName || ""}`.trim(),
        headline: ent.headline || "",
        public_id: ent.publicIdentifier || "",
      });
    }
  }

  // Parse invitation entities
  const invitations: Invitation[] = [];

  for (const ent of included) {
    const entType = ent.$type || "";
    if (!entType.includes("Invitation") && !entType.includes("invitation")) continue;
    if (entType.includes("MiniProfile")) continue;

    const invitationUrn = ent.entityUrn || "";
    const invitationId = invitationUrn.split(":").pop() || invitationUrn;

    // Find associated sender profile
    let senderName = extractText(ent.title);
    let senderHeadline = extractText(ent.subtitle);
    let senderPublicId = "";

    // Try to resolve from MiniProfile references in included
    if (!senderName) {
      for (const [, profile] of miniProfiles) {
        // First non-self profile is likely the sender/recipient
        if (profile.name) {
          senderName = profile.name;
          senderHeadline = profile.headline;
          senderPublicId = profile.public_id;
          break;
        }
      }
    }

    const sentAt = ent.sentTime
      ? new Date(ent.sentTime).toISOString()
      : "";

    invitations.push({
      id: invitationId,
      invitation_urn: invitationUrn,
      sender_name: senderName,
      sender_headline: senderHeadline,
      sender_public_id: senderPublicId,
      message: ent.message || "",
      sent_at: sentAt,
      invitation_type: type,
    });
  }

  log("info", `Fetched ${invitations.length} ${type} invitations`);
  return { invitations, total: invitations.length };
}

// -- Respond to Invitation ----------------------------------------------------

/**
 * Accept or ignore a pending connection request.
 * @param invitationId The invitation ID (from getInvitations)
 * @param action Whether to accept or ignore the invitation
 * @returns Success status
 */
export async function respondInvitation(
  invitationId: string,
  action: "accept" | "ignore",
): Promise<{ success: boolean }> {
  const path = `/relationships/invitations/${encodeURIComponent(invitationId)}?action=${action}`;

  await voyagerRequest<Record<string, unknown>>(path, { method: "PUT" });

  log("info", `${action === "accept" ? "Accepted" : "Ignored"} invitation ${invitationId}`);
  return { success: true };
}

// -- Get Connections ----------------------------------------------------------

/**
 * List your LinkedIn connections with pagination.
 * @param count Number of connections to return (max 100, default 50)
 * @param start Pagination offset (default 0)
 * @returns Array of connections
 */
export async function getConnections(
  count?: number,
  start?: number,
): Promise<{ connections: Connection[]; total: number }> {
  const limit = Math.min(count || 50, 100);
  const offset = start || 0;
  const path =
    `/relationships/dash/connections?count=${limit}&start=${offset}` +
    `&decorationId=com.linkedin.voyager.dash.deco.web.mynetwork.ConnectionList-3`;

  const response = await voyagerRequest<VoyagerConnectionsResponse>(path);
  const included = response.included || [];

  // Build MiniProfile lookup
  const miniProfiles = new Map<string, {
    name: string;
    headline: string;
    public_id: string;
    profile_urn: string;
  }>();

  for (const ent of included) {
    const entType = ent.$type || "";
    if (entType.includes("MiniProfile") && ent.firstName) {
      miniProfiles.set(ent.entityUrn || "", {
        name: `${ent.firstName} ${ent.lastName || ""}`.trim(),
        headline: ent.headline || "",
        public_id: ent.publicIdentifier || "",
        profile_urn: ent.objectUrn || ent.entityUrn || "",
      });
    }
  }

  // Parse connection entities
  const connections: Connection[] = [];

  for (const ent of included) {
    const entType = ent.$type || "";
    if (!entType.includes("Connection")) continue;
    if (entType.includes("MiniProfile")) continue;

    const connectedMemberRef = ent.connectedMember as string || "";
    const profile = miniProfiles.get(connectedMemberRef);

    const connectedAt = ent.createdAt
      ? new Date(ent.createdAt).toISOString()
      : "";

    if (profile) {
      connections.push({
        name: profile.name,
        headline: profile.headline,
        public_id: profile.public_id,
        profile_urn: profile.profile_urn,
        connected_at: connectedAt,
      });
    }
  }

  const total = response.paging?.total || connections.length;

  log("info", `Fetched ${connections.length} connections (total: ${total}, offset: ${offset})`);
  return { connections, total };
}
