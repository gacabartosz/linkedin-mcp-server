import { linkedinRequest, getPersonUrn } from "./client.js";
import { LinkedInApiError } from "../utils/errors.js";
import { log } from "../utils/logger.js";

interface PostCreateOptions {
  text: string;
  visibility?: "PUBLIC" | "CONNECTIONS";
  media_ids?: string[];
  article_url?: string;
  article_title?: string;
  article_description?: string;
}

interface LinkedInPostResponse {
  id?: string;
  "x-restli-id"?: string;
}

/**
 * Create a post using the new /rest/posts API.
 * Falls back to v2/ugcPosts if the token lacks permissions for the new API.
 */
export async function createPost(options: PostCreateOptions): Promise<{
  post_urn: string;
  created_at: string;
}> {
  try {
    return await createPostRest(options);
  } catch (err) {
    if (err instanceof LinkedInApiError && err.status === 403) {
      log("info", "Falling back to v2/ugcPosts API");
      return await createPostUgc(options);
    }
    throw err;
  }
}

/** New /rest/posts API (requires Community Management permissions) */
async function createPostRest(options: PostCreateOptions): Promise<{
  post_urn: string;
  created_at: string;
}> {
  const personUrn = getPersonUrn();

  const body: Record<string, unknown> = {
    author: personUrn,
    commentary: options.text,
    visibility: options.visibility === "CONNECTIONS" ? "CONNECTIONS" : "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };

  if (options.media_ids && options.media_ids.length > 0) {
    if (options.media_ids.length === 1) {
      body.content = { media: { id: options.media_ids[0] } };
    } else {
      body.content = {
        multiImage: { images: options.media_ids.map((id) => ({ id })) },
      };
    }
  }

  if (options.article_url && !options.media_ids?.length) {
    body.content = {
      article: {
        source: options.article_url,
        title: options.article_title || "",
        description: options.article_description || "",
      },
    };
  }

  const response = await linkedinRequest<LinkedInPostResponse>("POST", "/posts", body);
  return {
    post_urn: response?.["x-restli-id"] || response?.id || "",
    created_at: new Date().toISOString(),
  };
}

/** Legacy v2/ugcPosts API (works with w_member_social scope) */
async function createPostUgc(options: PostCreateOptions): Promise<{
  post_urn: string;
  created_at: string;
}> {
  const personUrn = getPersonUrn();

  const shareContent: Record<string, unknown> = {
    shareCommentary: { text: options.text },
    shareMediaCategory: "NONE",
  };

  if (options.media_ids && options.media_ids.length > 0) {
    shareContent.shareMediaCategory = "IMAGE";
    shareContent.media = options.media_ids.map((id) => ({
      status: "READY",
      media: id,
    }));
  }

  if (options.article_url && !options.media_ids?.length) {
    shareContent.shareMediaCategory = "ARTICLE";
    shareContent.media = [
      {
        status: "READY",
        originalUrl: options.article_url,
        title: { text: options.article_title || "" },
        description: { text: options.article_description || "" },
      },
    ];
  }

  const body = {
    author: personUrn,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": shareContent,
    },
    visibility: {
      "com.linkedin.ugc.MemberNetworkVisibility":
        options.visibility === "CONNECTIONS" ? "CONNECTIONS" : "PUBLIC",
    },
  };

  const response = await linkedinRequest<{ id?: string }>(
    "POST",
    "/ugcPosts",
    body,
    { apiBase: "v2" },
  );

  return {
    post_urn: response?.id || "",
    created_at: new Date().toISOString(),
  };
}

export async function updatePost(postUrn: string, text: string): Promise<{ updated: boolean }> {
  try {
    await linkedinRequest("POST", `/posts/${encodeURIComponent(postUrn)}`, {
      patch: { $set: { commentary: text } },
    });
  } catch (err) {
    if (err instanceof LinkedInApiError && err.status === 403) {
      // v2 ugcPosts doesn't support easy updates — re-throw with message
      throw new Error("Post update requires Community Management API permissions. Try deleting and re-creating the post.");
    }
    throw err;
  }
  return { updated: true };
}

export async function deletePost(postUrn: string): Promise<{ deleted: boolean }> {
  try {
    await linkedinRequest("DELETE", `/posts/${encodeURIComponent(postUrn)}`);
  } catch (err) {
    if (err instanceof LinkedInApiError && err.status === 403) {
      log("info", "Falling back to v2/ugcPosts DELETE");
      await linkedinRequest("DELETE", `/ugcPosts/${encodeURIComponent(postUrn)}`, undefined, { apiBase: "v2" });
    } else {
      throw err;
    }
  }
  return { deleted: true };
}

export async function getPost(postUrn: string): Promise<Record<string, unknown>> {
  try {
    return await linkedinRequest("GET", `/posts/${encodeURIComponent(postUrn)}`);
  } catch (err) {
    if (err instanceof LinkedInApiError && err.status === 403) {
      log("info", "Falling back to v2/ugcPosts GET");
      return await linkedinRequest("GET", `/ugcPosts/${encodeURIComponent(postUrn)}`, undefined, { apiBase: "v2" });
    }
    throw err;
  }
}

export async function listPosts(count: number = 10, start: number = 0): Promise<{
  posts: Array<Record<string, unknown>>;
  total: number;
}> {
  const personUrn = getPersonUrn();
  const encodedUrn = encodeURIComponent(personUrn);

  try {
    const response = await linkedinRequest<{
      elements: Array<Record<string, unknown>>;
      paging?: { total?: number };
    }>("GET", `/posts?author=${encodedUrn}&q=author&count=${count}&start=${start}`);

    return {
      posts: response.elements || [],
      total: response.paging?.total || 0,
    };
  } catch (err) {
    if (err instanceof LinkedInApiError && err.status === 403) {
      log("info", "Falling back to v2/ugcPosts list");
      const response = await linkedinRequest<{
        elements: Array<Record<string, unknown>>;
        paging?: { total?: number };
      }>("GET", `/ugcPosts?q=authors&authors=List(${encodedUrn})&count=${count}&start=${start}`, undefined, { apiBase: "v2" });

      return {
        posts: response.elements || [],
        total: response.paging?.total || 0,
      };
    }
    throw err;
  }
}

export async function repost(postUrn: string, commentary?: string): Promise<{
  repost_urn: string;
}> {
  const personUrn = getPersonUrn();

  const body: Record<string, unknown> = {
    author: personUrn,
    lifecycleState: "PUBLISHED",
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    ...(commentary
      ? {
          commentary,
          content: { reshare: { resharedPost: postUrn } },
        }
      : {
          content: { reshare: { resharedPost: postUrn } },
        }),
  };

  const response = await linkedinRequest<LinkedInPostResponse>("POST", "/posts", body);
  return { repost_urn: response?.["x-restli-id"] || "" };
}
