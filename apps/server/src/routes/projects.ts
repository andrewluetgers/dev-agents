import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { OrchestratorConfig } from "@dev-agents/shared";

const ORCHESTRATOR_HOME = process.env.ORCHESTRATOR_HOME ||
  join(process.env.HOME || "/tmp", "dev-agents", "orchestrator");

export const projectsRouter = new Hono();

function loadConfig(): OrchestratorConfig {
  const configPath = join(ORCHESTRATOR_HOME, "config.json");
  return JSON.parse(readFileSync(configPath, "utf-8"));
}

// List registered projects
projectsRouter.get("/", (c) => {
  try {
    const config = loadConfig();
    const projects = Object.entries(config.projects).map(([name, proj]) => ({
      name,
      ...proj,
    }));
    return c.json(projects);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Orchestrator config
projectsRouter.get("/config", (c) => {
  try {
    return c.json(loadConfig());
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});
