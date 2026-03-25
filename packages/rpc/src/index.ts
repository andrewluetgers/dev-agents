import { agentRouter } from "./procedures/agents.js";
import { projectRouter } from "./procedures/projects.js";

export const router = {
  agent: agentRouter,
  project: projectRouter,
};

export type AppRouter = typeof router;
export type { Context } from "./context.js";
