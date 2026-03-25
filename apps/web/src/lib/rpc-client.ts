import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { AppRouter } from "@dev-agents/rpc";

const link = new RPCLink({
  url: `${window.location.origin}/api/rpc`,
  headers: () => ({ "Content-Type": "application/json" }),
});

// Direct RPC client
export const rpc = createORPCClient<AppRouter>(link);

// TanStack Query integration
export const orpc = createTanstackQueryUtils<AppRouter>(rpc);
