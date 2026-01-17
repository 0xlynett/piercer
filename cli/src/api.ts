import OpenAI from "openai";
import type {
  ControllerInfo,
  Agent,
  ModelMapping,
  DownloadResult,
  AvailableModel,
  ToolDefinition,
  ToolCall,
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

export async function listModels(url: string): Promise<AvailableModel[]> {
  const baseUrl = getBaseUrl(url);
  const mappings = await request<ModelMapping[]>(
    baseUrl,
    "/management/mappings"
  );
  return mappings.map((m) => ({
    public_name: m.public_name,
    internal_name: m.internal_name,
  }));
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
  if (!apiKey && !process.env.API_KEY) throw new Error("No API key configured");
  const baseUrl = getBaseUrl(url);
  return new OpenAI({
    baseURL: `${baseUrl}/v1`,
    apiKey: apiKey || process.env.API_KEY,
    dangerouslyAllowBrowser: true,
  });
}

export async function chat(
  client: OpenAI,
  model: string,
  messages: Array<{
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    reasoning_content?: string;
  }>,
  onChunk: (
    content: string,
    reasoningContent?: string,
    toolCalls?: ToolCall[]
  ) => void,
  tools?: ToolDefinition[]
): Promise<void> {
  const stream = await client.chat.completions.create({
    model,
    messages: messages as any,
    max_tokens: 4096,
    stream: true,
    tools: tools as any,
  });

  let accumulatedToolCalls: ToolCall[] = [];

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta as any;
    if (delta) {
      const content = delta.content;
      const reasoning = delta.reasoning_content;

      // Handle tool calls
      if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const existingIndex = accumulatedToolCalls.findIndex(
            (t) => t.id === tc.id
          );
          if (existingIndex >= 0) {
            if (tc.function?.arguments && accumulatedToolCalls[existingIndex]) {
              accumulatedToolCalls[existingIndex].function.arguments +=
                tc.function.arguments;
            }
          } else {
            accumulatedToolCalls.push({
              id: tc.id,
              type: tc.type || "function",
              function: {
                name: tc.function?.name || "",
                arguments: tc.function?.arguments || "",
              },
            });
          }
        }
      }

      if (content || reasoning || accumulatedToolCalls.length > 0) {
        onChunk(
          content || "",
          reasoning || undefined,
          accumulatedToolCalls.length > 0
            ? [...accumulatedToolCalls]
            : undefined
        );
      }
    }
  }
}

export async function listOpenAIModels(
  client: OpenAI
): Promise<AvailableModel[]> {
  try {
    const response = await client.models.list();
    return response.data.map((m) => ({
      public_name: m.id,
      internal_name: m.id,
    }));
  } catch {
    // Fallback for controllers that don't implement /v1/models
    return [];
  }
}
