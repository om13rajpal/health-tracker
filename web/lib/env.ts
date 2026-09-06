export function getApiBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) {
    throw new Error("Missing required env var: NEXT_PUBLIC_API_URL");
  }
  return url;
}
