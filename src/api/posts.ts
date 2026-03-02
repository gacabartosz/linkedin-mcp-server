import { linkedinRequest, getPersonUrn } from "./client.js";

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

export async function createPost(options: PostCreateOptions): Promise<{
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

  // Image/video content
  if (options.media_ids && options.media_ids.length > 0) {
    if (options.media_ids.length === 1) {
      body.content = {
        media: { id: options.media_ids[0] },
      };
    } else {
      body.content = {
        multiImage: {
          images: options.media_ids.map((id) => ({ id })),
        },
      };
    }
  }

  // Article content
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

  const postUrn = response?.["x-restli-id"] || response?.id || "";

  return {
    post_urn: postUrn,
    created_at: new Date().toISOString(),
  };
}

export async function updatePost(postUrn: string, text: string): Promise<{ updated: boolean }> {
  await linkedinRequest("POST", `/posts/${encodeURIComponent(postUrn)}`, {
    patch: {
      $set: { commentary: text },
    },
  });
  return { updated: true };
}

export async function deletePost(postUrn: string): Promise<{ deleted: boolean }> {
  await linkedinRequest("DELETE", `/posts/${encodeURIComponent(postUrn)}`);
  return { deleted: true };
}

export async function getPost(postUrn: string): Promise<Record<string, unknown>> {
  return linkedinRequest("GET", `/posts/${encodeURIComponent(postUrn)}`);
}

export async function listPosts(count: number = 10, start: number = 0): Promise<{
  posts: Array<Record<string, unknown>>;
  total: number;
}> {
  const personUrn = getPersonUrn();
  const encodedUrn = encodeURIComponent(personUrn);
  const response = await linkedinRequest<{
    elements: Array<Record<string, unknown>>;
    paging?: { total?: number };
  }>("GET", `/posts?author=${encodedUrn}&q=author&count=${count}&start=${start}`);

  return {
    posts: response.elements || [],
    total: response.paging?.total || 0,
  };
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
