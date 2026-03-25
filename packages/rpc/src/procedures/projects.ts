import { os } from "@orpc/server";
import type { Context } from "../context.js";
import type { OrchestratorConfig } from "@dev-agents/shared";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const proc = os.$context<Context>();

const ORCHESTRATOR_HOME = process.env.ORCHESTRATOR_HOME ||
  join(process.env.HOME || "/tmp", "dev-agents", "orchestrator");

function loadConfig(): OrchestratorConfig {
  return JSON.parse(readFileSync(join(ORCHESTRATOR_HOME, "config.json"), "utf-8"));
}

export const list = proc.handler(async () => {
  const config = loadConfig();
  return Object.entries(config.projects).map(([name, proj]) => ({
    name,
    ...proj,
  }));
});

export const config = proc.handler(async () => {
  return loadConfig();
});

export const projectRouter = {
  list,
  config,
};
