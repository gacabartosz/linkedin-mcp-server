import { linkedinRequest, getPersonUrn } from "./client.js";

type ReactionType = "LIKE" | "CELEBRATE" | "SUPPORT" | "LOVE" | "INSIGHTFUL" | "FUNNY";

export async function addReaction(
  entityUrn: string,
  reactionType: ReactionType,
): Promise<{ reacted: boolean }> {
  const personUrn = getPersonUrn();
  const encodedEntity = encodeURIComponent(entityUrn);

  await linkedinRequest("POST", `/socialActions/${encodedEntity}/likes`, {
    actor: personUrn,
    object: entityUrn,
    reactionType,
  });

  return { reacted: true };
}

export async function removeReaction(entityUrn: string): Promise<{ removed: boolean }> {
  const personUrn = getPersonUrn();
  const encodedEntity = encodeURIComponent(entityUrn);
  const encodedActor = encodeURIComponent(personUrn);

  await linkedinRequest("DELETE", `/socialActions/${encodedEntity}/likes/${encodedActor}`);
  return { removed: true };
}
