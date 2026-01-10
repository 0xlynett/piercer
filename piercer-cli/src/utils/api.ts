import ky from "ky";

const CONTROLLER_URL = process.env.CONTROLLER_URL || "http://localhost:3001";

export const client = ky.create({
  prefixUrl: CONTROLLER_URL,
});

export async function getAgents() {
  const response = await client.get("management/agents");
  return response.json();
}

export async function getMappings() {
  const response = await client.get("management/mappings");
  return response.json();
}

export async function addMapping(publicName: string, filename: string) {
  const response = await client.post("management/mappings", {
    json: { public_name: publicName, filename },
  });
  return response.json();
}

export async function deleteMapping(publicName: string) {
  const response = await client.delete(`management/mappings/${publicName}`);
  return response.json();
}

export async function downloadModelToAgent(
  agentId: string,
  modelUrl: string,
  filename: string
) {
  const response = await client.post(
    `management/agents/${agentId}/models/download`,
    {
      json: { model_url: modelUrl, filename },
    }
  );
  return response.json();
}
