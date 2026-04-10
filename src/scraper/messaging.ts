/**
 * LinkedIn Messaging via Voyager API
 *
 * Provides conversation listing, message reading, sending messages,
 * and creating new conversations through LinkedIn's internal messaging API.
 * Uses LEGACY_INBOX key version for backward compatibility.
 */

import { voyagerRequest } from "./voyager.js";
import { log } from "../utils/logger.js";

// -- Types --------------------------------------------------------------------

export interface ConversationParticipant {
  name: string;
  headline: string;
  public_id: string;
  profile_urn: string;
}

export interface Conversation {
  id: string;
  participants: ConversationParticipant[];
  last_message: string;
  unread_count: number;
  last_activity_at: string;
}

export interface Message {
  id: string;
  text: string;
  sender_name: string;
  sender_public_id: string;
  timestamp: string;
  event_urn: string;
}

// -- Voyager Response Types ---------------------------------------------------

interface VoyagerMessagingResponse {
  data?: Record<string, unknown>;
  included?: VoyagerMessagingEntity[];
  elements?: VoyagerMessagingEntity[];
}

interface VoyagerMessagingEntity {
  $type?: string;
  entityUrn?: string;
  // Conversation fields
  events?: unknown[];
  participants?: unknown[];
  unreadCount?: number;
  lastActivityAt?: number;
  read?: boolean;
  // Event/message fields
  subtype?: string;
  body?: string;
  eventContent?: {
    "com.linkedin.voyager.messaging.event.MessageEvent"?: {
      body?: string;
      attachments?: unknown[];
    };
    messageEvent?: {
      body?: string;
      attachments?: unknown[];
    };
    [key: string]: unknown;
  };
  createdAt?: number;
  from?: string | { "com.linkedin.voyager.messaging.MessagingMember"?: { miniProfile?: unknown } };
  // MiniProfile fields
  firstName?: string;
  lastName?: string;
  headline?: string;
  publicIdentifier?: string;
  objectUrn?: string;
  [key: string]: unknown;
}

// -- Helper: extract text from Voyager objects --------------------------------

function extractText(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.text === "string") return obj.text;
  }
  return "";
}

// -- Get Conversations --------------------------------------------------------

/**
 * Fetch recent messaging conversations from LinkedIn inbox.
 * @param count Number of conversations to return (max 40, default 20)
 * @returns Array of conversations with participants, last message, and unread count
 */
export async function getConversations(count?: number): Promise<{
  conversations: Conversation[];
  total: number;
}> {
  const limit = Math.min(count || 20, 40);

  // GraphQL messaging endpoint (2025+ LinkedIn) requires mailboxUrn
  const mailboxUrn = "urn:li:fsd_profile:ACoAABVV1NsBpgxKZg2hBBTNL8O7hVLAL7kRchY";
  let response: VoyagerMessagingResponse;
  try {
    response = await voyagerRequest<VoyagerMessagingResponse>(
      `/voyagerMessagingGraphQL/graphql?queryId=messengerConversations.0d5e6781bbee71c3e51c8843c6519f48&variables=(count:${limit},mailboxUrn:${encodeURIComponent(mailboxUrn)})`
    );
  } catch {
    try {
      response = await voyagerRequest<VoyagerMessagingResponse>(
        `/messaging/conversations?keyVersion=LEGACY_INBOX&count=${limit}`
      );
    } catch (err: any) {
      log("error", `Messaging conversations failed: ${err.message}`);
      return { conversations: [], total: 0 };
    }
  }
  const included = response.included || [];

  // Build participant lookup from MessagingParticipant entities (new format)
  const participantMap = new Map<string, ConversationParticipant>();
  for (const ent of included) {
    const type = (ent.$type || "").split(".").pop() || "";
    if (type === "MessagingParticipant" && ent.participantType) {
      const member = (ent.participantType as any)?.member;
      if (member) {
        const firstName = extractText(member.firstName);
        const lastName = extractText(member.lastName);
        participantMap.set(ent.entityUrn || "", {
          name: `${firstName} ${lastName}`.trim(),
          headline: extractText(member.headline) || "",
          public_id: member.profileUrl?.split("/in/")[1]?.replace(/\//g, "") || "",
          profile_urn: (ent.hostIdentityUrn as string) || "",
        });
      }
    }
    // Legacy: MiniProfile
    if (type === "MiniProfile" && ent.firstName) {
      participantMap.set(ent.entityUrn || "", {
        name: `${ent.firstName} ${ent.lastName || ""}`.trim(),
        headline: (ent.headline as string) || "",
        public_id: (ent.publicIdentifier as string) || "",
        profile_urn: (ent.objectUrn as string) || ent.entityUrn || "",
      });
    }
  }

  // Build message lookup
  const messageTexts = new Map<string, string>();
  for (const ent of included) {
    const type = (ent.$type || "").split(".").pop() || "";
    if (type === "Message" && ent.body) {
      messageTexts.set(ent.entityUrn || "", extractText(ent.body));
    }
    if ((type === "Event" || type.includes("event")) && ent.body) {
      messageTexts.set(ent.entityUrn || "", extractText(ent.body));
    }
  }

  // Parse Conversation entities
  const conversations: Conversation[] = [];
  for (const ent of included) {
    const type = (ent.$type || "").split(".").pop() || "";
    if (type !== "Conversation") continue;

    const conversationUrn = ent.entityUrn || "";
    const conversationId = conversationUrn;

    // Resolve participants — try multiple ref fields
    const participants: ConversationParticipant[] = [];
    const partRefs = (
      ent["*conversationParticipants"] || ent["*participants"] || ent.participants || []
    ) as string[];
    for (const ref of partRefs) {
      const refStr = typeof ref === "string" ? ref : (ref as any).entityUrn || "";
      // Direct lookup
      let p = participantMap.get(refStr);
      // Fallback: match by profile URN embedded in participant URN
      if (!p) {
        for (const [key, val] of participantMap) {
          if (refStr.includes(val.profile_urn.split(":").pop() || "___") || key.includes(refStr.split(":").pop() || "___")) {
            p = val;
            break;
          }
        }
      }
      if (p) participants.push(p);
    }

    // Last message — from messages.*elements refs or direct Message entities
    let lastMessage = "";
    const msgElements = (ent.messages as any)?.["*elements"] || [];
    if (msgElements.length > 0 && messageTexts.has(msgElements[0])) {
      lastMessage = messageTexts.get(msgElements[0]) || "";
    }
    // Fallback: descriptionText
    if (!lastMessage && ent.descriptionText) {
      lastMessage = extractText(ent.descriptionText);
    }
    // Fallback: first message in map
    if (!lastMessage && messageTexts.size > 0) {
      for (const [, text] of messageTexts) {
        if (text) { lastMessage = text; break; }
      }
    }

    const lastActivityAt = ent.lastActivityAt
      ? new Date(ent.lastActivityAt as number).toISOString()
      : "";

    conversations.push({
      id: conversationId,
      participants,
      last_message: lastMessage,
      unread_count: (ent.unreadCount as number) || 0,
      last_activity_at: lastActivityAt,
    });
  }

  log("info", `Fetched ${conversations.length} conversations`);
  return { conversations, total: conversations.length };
}

// -- Get Conversation Messages ------------------------------------------------

/**
 * Fetch messages from a specific conversation thread.
 * @param conversationId The conversation URN ID
 * @param count Number of messages to return (max 40, default 20)
 * @returns Array of messages in the conversation
 */
export async function getConversationMessages(
  conversationId: string,
  count?: number,
): Promise<{ messages: Message[]; total: number }> {
  const limit = Math.min(count || 20, 40);

  // Try GraphQL messages endpoint first
  let response: VoyagerMessagingResponse;
  try {
    response = await voyagerRequest<VoyagerMessagingResponse>(
      `/voyagerMessagingGraphQL/graphql?queryId=messengerMessages.5846eeb71c981f11e0134cb6626cc314&variables=(conversationUrn:${encodeURIComponent(conversationId)},count:${limit})`
    );
  } catch {
    try {
      response = await voyagerRequest<VoyagerMessagingResponse>(
        `/messaging/conversations/${encodeURIComponent(conversationId)}/events?keyVersion=LEGACY_INBOX&count=${limit}`
      );
    } catch (err: any) {
      log("error", `Messages fetch failed: ${err.message}`);
      return { messages: [], total: 0 };
    }
  }
  const included = response.included || [];

  // Build MiniProfile lookup
  const miniProfiles = new Map<string, { name: string; public_id: string }>();
  for (const ent of included) {
    const type = ent.$type || "";
    if (type.includes("MiniProfile") && ent.firstName) {
      miniProfiles.set(ent.entityUrn || "", {
        name: `${ent.firstName} ${ent.lastName || ""}`.trim(),
        public_id: ent.publicIdentifier || "",
      });
    }
  }

  // Parse message events
  const messages: Message[] = [];

  for (const ent of included) {
    const type = ent.$type || "";
    if (!type.includes("Event")) continue;

    const body =
      ent.body ||
      ent.eventContent?.["com.linkedin.voyager.messaging.event.MessageEvent"]?.body ||
      ent.eventContent?.messageEvent?.body;

    const text = extractText(body);
    if (!text) continue;

    // Resolve sender
    let senderName = "";
    let senderPublicId = "";
    const fromRef = typeof ent.from === "string" ? ent.from : "";

    if (fromRef) {
      // Look for MessagingMember -> MiniProfile chain
      for (const ref of included) {
        if (ref.entityUrn === fromRef || (ref.entityUrn || "").includes(fromRef.split(":").pop() || "___")) {
          const profileRef = ref.miniProfile as string || "";
          const profile = miniProfiles.get(profileRef);
          if (profile) {
            senderName = profile.name;
            senderPublicId = profile.public_id;
            break;
          }
        }
      }
    }

    // Fallback: try from field as MessagingMember object
    if (!senderName && typeof ent.from === "object" && ent.from !== null) {
      const member = (ent.from as Record<string, unknown>)["com.linkedin.voyager.messaging.MessagingMember"];
      if (member && typeof member === "object") {
        const mp = (member as Record<string, unknown>).miniProfile as Record<string, unknown>;
        if (mp) {
          senderName = `${mp.firstName || ""} ${mp.lastName || ""}`.trim();
          senderPublicId = (mp.publicIdentifier as string) || "";
        }
      }
    }

    const timestamp = ent.createdAt
      ? new Date(ent.createdAt).toISOString()
      : "";

    messages.push({
      id: (ent.entityUrn || "").split(":").pop() || "",
      text,
      sender_name: senderName,
      sender_public_id: senderPublicId,
      timestamp,
      event_urn: ent.entityUrn || "",
    });
  }

  // Sort by timestamp descending (newest first)
  messages.sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1));

  log("info", `Fetched ${messages.length} messages from conversation ${conversationId}`);
  return { messages, total: messages.length };
}

// -- Send Message -------------------------------------------------------------

/**
 * Send a message in an existing conversation.
 * @param conversationId The conversation URN ID
 * @param text Message body text
 * @returns Success status and event URN
 */
export async function sendMessage(
  conversationId: string,
  text: string,
): Promise<{ success: boolean; event_urn: string }> {
  if (!text.trim()) {
    throw new Error("Message text cannot be empty");
  }

  const path = `/messaging/conversations/${encodeURIComponent(conversationId)}/events?action=create`;

  const body = {
    eventCreate: {
      value: {
        "com.linkedin.voyager.messaging.create.MessageCreate": {
          body: text,
          attachments: [],
        },
      },
    },
  };

  const response = await voyagerRequest<{
    value?: { entityUrn?: string; [key: string]: unknown };
    [key: string]: unknown;
  }>(path, { method: "POST", body });

  const eventUrn = response.value?.entityUrn || "";
  log("info", `Sent message to conversation ${conversationId}`);

  return { success: true, event_urn: eventUrn };
}

// -- Create Conversation ------------------------------------------------------

/**
 * Start a new conversation with one or more recipients.
 * @param recipientUrns Array of recipient profile URNs (e.g., "urn:li:fsd_profile:ACoAAA...")
 * @param text Initial message body text
 * @returns The new conversation ID
 */
export async function createConversation(
  recipientUrns: string[],
  text: string,
): Promise<{ success: boolean; conversation_id: string }> {
  if (!recipientUrns.length) {
    throw new Error("At least one recipient URN is required");
  }
  if (!text.trim()) {
    throw new Error("Message text cannot be empty");
  }

  const path = `/messaging/conversations?action=create`;

  const body = {
    recipients: recipientUrns,
    subject: null,
    body: text,
    keyVersion: "LEGACY_INBOX",
  };

  const response = await voyagerRequest<{
    value?: { entityUrn?: string; conversationUrn?: string; [key: string]: unknown };
    [key: string]: unknown;
  }>(path, { method: "POST", body });

  const conversationUrn = response.value?.conversationUrn || response.value?.entityUrn || "";
  const conversationId = conversationUrn.split(":").pop() || conversationUrn;

  log("info", `Created new conversation ${conversationId} with ${recipientUrns.length} recipient(s)`);

  return { success: true, conversation_id: conversationId };
}
