import { linkedinRequest, getPersonUrn } from "./client.js";
import { LinkedInApiError } from "../utils/errors.js";
import { log } from "../utils/logger.js";

export async function createComment(
  postUrn: string,
  text: string,
  parentCommentUrn?: string,
): Promise<{ comment_urn: string; created_at: string }> {
  const personUrn = getPersonUrn();

  // Path: gdy reply, użyj activity URN; gdy top-level, użyj share URN
  let pathUrn = postUrn;
  if (parentCommentUrn) {
    const m = parentCommentUrn.match(/activity:(\d+)/);
    if (m) pathUrn = `urn:li:activity:${m[1]}`;
  }
  const encodedPath = encodeURIComponent(pathUrn);

  // Body: object MUSI być, LinkedIn API wymaga go żeby wiedzieć do którego posta
  // przypisać komentarz. Bez object → 400 "Error while parsing the request".
  const body: Record<string, unknown> = {
    actor: personUrn,
    object: postUrn,  // share URN posta (zawsze, niezależnie od reply/top-level)
    message: { text },
    ...(parentCommentUrn ? { parentComment: parentCommentUrn } : {}),
  };

  // VERBOSE LOG (do diagnozy 400 — usuń po naprawieniu)
  log("info", `[createComment] path=${pathUrn}`);
  log("info", `[createComment] body=${JSON.stringify(body)}`);

  let response: { "x-restli-id"?: string; id?: string };
  try {
    response = await linkedinRequest<{ "x-restli-id"?: string; id?: string }>(
      "POST",
      `/socialActions/${encodedPath}/comments`,
      body,
    );
  } catch (err) {
    if (err instanceof LinkedInApiError) {
      log("error", `[createComment] /rest failed: status=${err.status} message=${err.message}`);
    }
    if (err instanceof LinkedInApiError && (err.status === 403 || err.status === 400)) {
      log("info", `Falling back to v2 socialActions (status ${err.status})`);
      try {
        response = await linkedinRequest<{ "x-restli-id"?: string; id?: string }>(
          "POST",
          `/socialActions/${encodedPath}/comments`,
          body,
          { apiBase: "v2" },
        );
      } catch (err2) {
        if (err2 instanceof LinkedInApiError) {
          log("error", `[createComment] /v2 also failed: status=${err2.status} message=${err2.message}`);
        }
        throw err2;
      }
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
