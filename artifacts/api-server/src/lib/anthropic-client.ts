import Anthropic from "@anthropic-ai/sdk";

// Provisioned by Replit's Anthropic AI integration -- no personal API key
// needed, usage is billed to Replit credits. Never overwrite these.
const baseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;

if (!baseURL || !apiKey) {
  throw new Error(
    "AI_INTEGRATIONS_ANTHROPIC_BASE_URL / AI_INTEGRATIONS_ANTHROPIC_API_KEY are not set. " +
      "The Replit Anthropic AI integration must be provisioned before starting the server.",
  );
}

export const anthropic = new Anthropic({ apiKey, baseURL });
