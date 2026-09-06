import { getApiBaseUrl } from "./env";

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${getApiBaseUrl()}${path}`, { ...init, credentials: "include" });
}
