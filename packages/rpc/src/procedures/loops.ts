import { os } from "@orpc/server";
import { z } from "zod";
import type { Context } from "../context.js";

const proc = os.$context<Context>();

export const list = proc
  .input(z.object({ agentId: z.string().optional() }).optional())
  .handler(async ({ input, context }) => {
    const all = [...context.loops.values()];
    if (input?.agentId) {
      return all.filter((l) => l.agentId === input.agentId);
    }
    return all;
  });

export const get = proc
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const loop = context.loops.get(input.id);
    if (!loop) throw new Error("Loop not found");
    return loop;
  });

export const create = proc
  .input(
    z.object({
      agentId: z.string(),
      command: z.string(),
      type: z.enum(["exec", "message"]),
      intervalMs: z.number().min(1000),
      label: z.string(),
    })
  )
  .handler(async ({ input, context }) => {
    const id = `loop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const loop = {
      id,
      agentId: input.agentId,
      command: input.command,
      type: input.type,
      intervalMs: input.intervalMs,
      label: input.label,
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    context.loops.set(id, loop);
    return loop;
  });

export const update = proc
  .input(
    z.object({
      id: z.string(),
      command: z.string().optional(),
      intervalMs: z.number().min(1000).optional(),
      enabled: z.boolean().optional(),
      label: z.string().optional(),
    })
  )
  .handler(async ({ input, context }) => {
    const loop = context.loops.get(input.id);
    if (!loop) throw new Error("Loop not found");
    if (input.command !== undefined) loop.command = input.command;
    if (input.intervalMs !== undefined) loop.intervalMs = input.intervalMs;
    if (input.enabled !== undefined) loop.enabled = input.enabled;
    if (input.label !== undefined) loop.label = input.label;
    return loop;
  });

export const remove = proc
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const existed = context.loops.delete(input.id);
    return { deleted: existed };
  });

export const loopRouter = {
  list,
  get,
  create,
  update,
  delete: remove,
};
