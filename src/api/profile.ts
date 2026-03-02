import { getPersonUrn } from "./client.js";
import { fetchWithTimeout } from "../utils/fetch.js";

interface UserInfo {
  sub: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  email?: string;
}

export async function getMyProfile(): Promise<{
  person_urn: string;
  first_name: string;
  last_name: string;
  name: string;
  profile_picture_url: string;
}> {
  const personUrn = getPersonUrn();

  // Use userinfo endpoint (OpenID Connect)
  const response = await fetchWithTimeout("https://api.linkedin.com/v2/userinfo", {
    headers: {
      Authorization: `Bearer ${(await import("./client.js")).loadTokens()!.access_token}`,
    },
  });

  if (!response.ok) {
    return {
      person_urn: personUrn,
      first_name: "",
      last_name: "",
      name: "Unknown",
      profile_picture_url: "",
    };
  }

  const data = await response.json() as UserInfo;

  return {
    person_urn: personUrn,
    first_name: data.given_name || "",
    last_name: data.family_name || "",
    name: data.name || `${data.given_name || ""} ${data.family_name || ""}`.trim(),
    profile_picture_url: data.picture || "",
  };
}
