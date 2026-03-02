export class LinkedInApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    const msg = typeof body === "object" && body !== null && "message" in body
      ? (body as { message: string }).message
      : JSON.stringify(body);
    super(`LinkedIn API ${status}: ${msg}`);
    this.name = "LinkedInApiError";
  }
}

export function toolError(message: string): { content: Array<{ type: "text"; text: string }>; isError: true } {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

export function toolResult(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}
