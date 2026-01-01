/**
 * AI parsing configuration and feature flags.
 * 
 * AI is now optional and BYOK (Bring Your Own Key).
 * Keys are provided via request headers (x-ai-enabled and x-openai-key).
 * No server-side OPENAI_API_KEY is required.
 */

/**
 * Check if AI parsing is enabled.
 * Now accepts parameters instead of checking environment variables.
 * 
 * @param aiEnabled - Whether AI is enabled (from x-ai-enabled header)
 * @param apiKey - The OpenAI API key (from x-openai-key header)
 * @returns true if AI is enabled and a valid key is provided
 */
export function isAiParsingEnabled(aiEnabled?: boolean, apiKey?: string | null): boolean {
  return aiEnabled === true && !!apiKey && apiKey.trim().length > 0;
}

/**
 * Get the OpenAI model name to use for parsing.
 * Defaults to "gpt-4o-mini" (cost-effective, good for structured extraction).
 * Can be overridden with OPENAI_MODEL_NAME environment variable.
 */
export function getAiModelName(): string {
  return process.env.OPENAI_MODEL_NAME || "gpt-4o-mini";
}

/**
 * Get industry profile configuration.
 * For now, returns a default profile. Later this could be per-tenant or configurable.
 */
export function getIndustryProfile(): {
  label: string;
  examples?: string;
} {
  return {
    label: process.env.INDUSTRY_PROFILE_LABEL || "Facility Management",
    examples: process.env.INDUSTRY_PROFILE_EXAMPLES || undefined,
  };
}

