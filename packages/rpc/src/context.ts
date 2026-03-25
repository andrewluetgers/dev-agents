import type { AgentInfo, Loop } from "@dev-agents/shared";

export interface Context {
  agents: Map<string, AgentInfo>;
  loops: Map<string, Loop>;
  saveLoops: () => void;
}
