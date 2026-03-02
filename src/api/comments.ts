import { linkedinRequest, getPersonUrn } from "./client.js";

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

  const response = await linkedinRequest<{ "x-restli-id"?: string; id?: string }>(
    "POST",
    `/socialActions/${encodedPost}/comments`,
    body,
  );

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
  const response = await linkedinRequest<{
    elements: Array<Record<string, unknown>>;
    paging?: { total?: number };
  }>("GET", `/socialActions/${encodedPost}/comments?count=${count}&start=${start}`);

  return {
    comments: response.elements || [],
    total: response.paging?.total || 0,
  };
}

export async function deleteComment(commentUrn: string): Promise<{ deleted: boolean }> {
  // Comments are deleted via the socialActions endpoint
  // The commentUrn contains the full path info
  await linkedinRequest("DELETE", `/socialActions/comments/${encodeURIComponent(commentUrn)}`);
  return { deleted: true };
}
