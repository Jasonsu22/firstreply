import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

export type LlmProtocol = "openai" | "anthropic";

export type LlmConfig = {
  protocol: LlmProtocol;
  baseURL: string;
  apiKey: string;
  model: string;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env (see .env.example)`);
  return value;
}

/** Reads the LLM gateway settings from env. `overrides` lets scripts test another protocol or model. */
export function getLlmConfig(overrides: Partial<LlmConfig> = {}): LlmConfig {
  const protocol = (overrides.protocol ?? process.env.LLM_PROTOCOL ?? "openai") as LlmProtocol;
  if (protocol !== "openai" && protocol !== "anthropic") {
    throw new Error(`LLM_PROTOCOL must be "openai" or "anthropic", got "${protocol}"`);
  }
  const anthropicBaseURL = protocol === "anthropic" ? process.env.LLM_ANTHROPIC_BASE_URL : undefined;
  const baseURL = overrides.baseURL || anthropicBaseURL || required("LLM_BASE_URL");
  return {
    protocol,
    baseURL,
    apiKey: overrides.apiKey ?? required("LLM_API_KEY"),
    model: overrides.model ?? required("LLM_MODEL"),
  };
}

/** Returns an AI SDK model that talks to the gateway in the configured format. */
export function getModel(config: LlmConfig = getLlmConfig()): LanguageModel {
  if (config.protocol === "anthropic") {
    return createAnthropic({ baseURL: config.baseURL, apiKey: config.apiKey })(config.model);
  }
  return createOpenAICompatible({
    name: "gateway",
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    supportsStructuredOutputs: true,
  })(config.model);
}
