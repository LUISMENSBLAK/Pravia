import prisma from '../config/prisma';
import { AiGateway, type AiGatewayRequest } from './aiGateway.service';
import { OpenAiResponsesGatewayAdapter } from './openaiResponsesGateway.adapter';

export type AiGatewayExecutor = {
  execute<T = unknown>(request: AiGatewayRequest): Promise<T>;
};

/**
 * Single runtime economic boundary for external AI. Domain services may depend
 * on AiGatewayExecutor for tests, but must never instantiate provider clients.
 */
export const aiGateway: AiGatewayExecutor = new AiGateway(prisma, [
  new OpenAiResponsesGatewayAdapter(prisma),
]);
