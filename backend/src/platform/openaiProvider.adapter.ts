/**
 * Sole OpenAI network boundary. Domain services must not know provider URLs.
 * This is the network boundary only. Legacy domain callers currently invoke
 * it without AiGateway reservation/settlement and are inventoried separately.
 */
export const openAiProviderFetch = (
  pathname: string,
  init: RequestInit,
  fetchImpl: typeof fetch = fetch,
) => {
  if (!pathname.startsWith('/v1/') || pathname.includes('://')) throw new Error('OPENAI_PROVIDER_PATH_INVALID');
  return fetchImpl(`https://api.openai.com${pathname}`, init);
};
