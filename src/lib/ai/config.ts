import "server-only";

// The Anthropic API key is read on the server only (ANTHROPIC_API_KEY).
// Never prefix it with NEXT_PUBLIC_.
export function isAiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

const DEFAULT_MODEL = "claude-opus-5-5";

export function aiModel() {
  const value = process.env.ANTHROPIC_MODEL?.trim();
  return value && /^[a-z0-9.\-]{3,60}$/.test(value) ? value : DEFAULT_MODEL;
}
