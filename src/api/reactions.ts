import { linkedinRequest, getPersonUrn } from "./client.js";
import { LinkedInApiError } from "../utils/errors.js";
import { log } from "../utils/logger.js";

type ReactionType = "LIKE" | "CELEBRATE" | "SUPPORT" | "LOVE" | "INSIGHTFUL" | "FUNNY";

export async function addReaction(
  entityUrn: string,
  reactionType: ReactionType,
): Promise<{ reacted: boolean }> {
  const personUrn = getPersonUrn();
  const encodedEntity = encodeURIComponent(entityUrn);

  const body = {
    actor: personUrn,
    object: entityUrn,
    reactionType,
  };

  try {
    await linkedinRequest("POST", `/socialActions/${encodedEntity}/likes`, body);
  } catch (err) {
    if (err instanceof LinkedInApiError && err.status === 403) {
      log("info", "Falling back to v2 socialActions for reaction");
      await linkedinRequest("POST", `/socialActions/${encodedEntity}/likes`, body, { apiBase: "v2" });
    } else {
      throw err;
    }
  }

  return { reacted: true };
}

export async function removeReaction(entityUrn: string): Promise<{ removed: boolean }> {
  const personUrn = getPersonUrn();
  const encodedEntity = encodeURIComponent(entityUrn);
  const encodedActor = encodeURIComponent(personUrn);

  try {
    await linkedinRequest("DELETE", `/socialActions/${encodedEntity}/likes/${encodedActor}`);
  } catch (err) {
    if (err instanceof LinkedInApiError && err.status === 403) {
      log("info", "Falling back to v2 socialActions for remove reaction");
      await linkedinRequest("DELETE", `/socialActions/${encodedEntity}/likes/${encodedActor}`, undefined, { apiBase: "v2" });
    } else {
      throw err;
    }
  }

  return { removed: true };
}
