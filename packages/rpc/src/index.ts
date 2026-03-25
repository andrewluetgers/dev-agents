import { agentRouter } from "./procedures/agents.js";
import { projectRouter } from "./procedures/projects.js";
import { loopRouter } from "./procedures/loops.js";

export const router = {
  agent: agentRouter,
  project: projectRouter,
  loop: loopRouter,
};

export type AppRouter = typeof router;
export type { Context } from "./context.js";
