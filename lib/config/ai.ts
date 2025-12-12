/**
 * AI parsing configuration and feature flags.
 * 
 * To enable AI parsing, install:
 * npm install openai pdf-parse
 * 
 * And set OPENAI_API_KEY in your environment.
 */

/**
 * Check if AI parsing is enabled.
 * Currently based on the presence of OPENAI_API_KEY.
 * Later we could add per-tenant flags or other configuration.
 */
export function isAiParsingEnabled(): boolean {
  return !!process.env.OPENAI_API_KEY;
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

