import { linkedinRequest, getPersonUrn } from "./client.js";
import { LinkedInApiError } from "../utils/errors.js";
import { log } from "../utils/logger.js";

export async function createComment(
  postUrn: string,
  text: string,
  parentCommentUrn?: string,
): Promise<{ comment_urn: string; created_at: string }> {
  const personUrn = getPersonUrn();
  const encodedPost = encodeURIComponent(postUrn);

  const body: Record<string, unknown> = {
    actor: personUrn,
    message: { text },
    ...(parentCommentUrn ? { parentComment: parentCommentUrn } : {}),
  };

  // Try /rest API first, fall back to v2
  let response: { "x-restli-id"?: string; id?: string };
  try {
    response = await linkedinRequest<{ "x-restli-id"?: string; id?: string }>(
      "POST",
      `/socialActions/${encodedPost}/comments`,
      body,
    );
  } catch (err) {
    if (err instanceof LinkedInApiError && err.status === 403) {
      log("info", "Falling back to v2 socialActions for comment");
      response = await linkedinRequest<{ "x-restli-id"?: string; id?: string }>(
        "POST",
        `/socialActions/${encodedPost}/comments`,
        body,
        { apiBase: "v2" },
      );
    } else {
      throw err;
    }
  }

  return {
    comment_urn: response?.["x-restli-id"] || response?.id || "",
    created_at: new Date().toISOString(),
  };
}

export async function listComments(
  postUrn: string,
  count: number = 10,
  start: number = 0,
): Promise<{
  comments: Array<Record<string, unknown>>;
  total: number;
}> {
  const encodedPost = encodeURIComponent(postUrn);

  let response: { elements: Array<Record<string, unknown>>; paging?: { total?: number } };
  try {
    response = await linkedinRequest<typeof response>(
      "GET",
      `/socialActions/${encodedPost}/comments?count=${count}&start=${start}`,
    );
  } catch (err) {
    if (err instanceof LinkedInApiError && err.status === 403) {
      log("info", "Falling back to v2 socialActions for list comments");
      response = await linkedinRequest<typeof response>(
        "GET",
        `/socialActions/${encodedPost}/comments?count=${count}&start=${start}`,
        undefined,
        { apiBase: "v2" },
      );
    } else {
      throw err;
    }
  }

  return {
    comments: response.elements || [],
    total: response.paging?.total || 0,
  };
}

export async function deleteComment(commentUrn: string): Promise<{ deleted: boolean }> {
  try {
    await linkedinRequest("DELETE", `/socialActions/comments/${encodeURIComponent(commentUrn)}`);
  } catch (err) {
    if (err instanceof LinkedInApiError && err.status === 403) {
      log("info", "Falling back to v2 for delete comment");
      await linkedinRequest("DELETE", `/socialActions/comments/${encodeURIComponent(commentUrn)}`, undefined, { apiBase: "v2" });
    } else {
      throw err;
    }
  }
  return { deleted: true };
}
