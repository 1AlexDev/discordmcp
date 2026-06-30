import { AsyncLocalStorage } from "node:async_hooks";

type McpRequestContext = {
  pokeUserId: string;
};

const requestContext = new AsyncLocalStorage<McpRequestContext>();

export function runWithMcpRequestContext<T>(
  context: McpRequestContext,
  callback: () => T,
): T {
  return requestContext.run(context, callback);
}

export function getCurrentPokeUserId(): string {
  const context = requestContext.getStore();
  if (!context?.pokeUserId) {
    throw new Error("Missing Poke user request context");
  }

  return context.pokeUserId;
}
