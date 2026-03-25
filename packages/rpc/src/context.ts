import type { AgentInfo } from "@dev-agents/shared";

export interface Context {
  agents: Map<string, AgentInfo>;
}
