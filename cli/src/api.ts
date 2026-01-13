import OpenAI from "openai";
import type {
  ControllerInfo,
  Agent,
  ModelMapping,
  DownloadResult,
} from "./types.js";

export function getBaseUrl(url: string): string {
  return url.replace(/\/$/, "");
}

export async function request<T>(
  baseUrl: string,
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`HTTP ${res.status}: ${errorText || res.statusText}`);
  }

  return res.json() as Promise<T>;
}

export async function fetchControllerInfo(
  url: string
): Promise<ControllerInfo> {
  const baseUrl = getBaseUrl(url);
  return request<ControllerInfo>(baseUrl, "/api/info");
}

export async function checkHealth(url: string): Promise<boolean> {
  const baseUrl = getBaseUrl(url);
  const res = await fetch(`${baseUrl}/health`);
  return res.ok;
}

export async function listAgents(url: string): Promise<Agent[]> {
  const baseUrl = getBaseUrl(url);
  return request<Agent[]>(baseUrl, "/management/agents");
}

export async function listMappings(url: string): Promise<ModelMapping[]> {
  const baseUrl = getBaseUrl(url);
  return request<ModelMapping[]>(baseUrl, "/management/mappings");
}

export async function addMapping(
  url: string,
  publicName: string,
  filename: string
): Promise<void> {
  const baseUrl = getBaseUrl(url);
  await request(baseUrl, "/management/mappings", {
    method: "POST",
    body: JSON.stringify({ public_name: publicName, filename }),
  });
}

export async function removeMapping(
  url: string,
  publicName: string
): Promise<void> {
  const baseUrl = getBaseUrl(url);
  await request(
    baseUrl,
    `/management/mappings/${encodeURIComponent(publicName)}`,
    {
      method: "DELETE",
    }
  );
}

export async function downloadModel(
  url: string,
  agentId: string,
  modelUrl: string,
  filename: string
): Promise<DownloadResult> {
  const baseUrl = getBaseUrl(url);
  return request<DownloadResult>(
    baseUrl,
    `/management/agents/${encodeURIComponent(agentId)}/models/download`,
    {
      method: "POST",
      body: JSON.stringify({ model_url: modelUrl, filename }),
    }
  );
}

export function createOpenAIClient(url: string, apiKey?: string): OpenAI {
  const baseUrl = getBaseUrl(url);
  return new OpenAI({
    baseURL: `${baseUrl}/v1`,
    apiKey: apiKey || process.env.API_KEY,
  });
}
