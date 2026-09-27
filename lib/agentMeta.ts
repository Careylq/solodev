import type { AgentId } from './types';

export type AgentMeta = {
  id: AgentId;
  title: string;
  subtitle: string;
  accent: string;
  maxTokens: number;
};

/** Client-safe agent metadata (no server-only imports). */
export const AGENT_META: AgentMeta[] = [
  {
    id: 'architecture',
    title: 'Architecture Mapper',
    subtitle: 'Layers, modules and the big picture',
    accent: '#818cf8',
    maxTokens: 3400,
  },
  {
    id: 'entrypoints',
    title: 'Entry-Point Detective',
    subtitle: 'How execution actually starts',
    accent: '#22d3ee',
    maxTokens: 2800,
  },
  {
    id: 'conventions',
    title: 'Convention & Risk Radar',
    subtitle: 'House rules, tooling and landmines',
    accent: '#fbbf24',
    maxTokens: 2800,
  },
  {
    id: 'firstTasks',
    title: 'First-Task Generator',
    subtitle: 'Three contributions you can ship today',
    accent: '#4ade80',
    maxTokens: 2400,
  },
  {
    id: 'onboarding',
    title: 'Ramp-Up Planner',
    subtitle: 'A seven-step path with checkpoints',
    accent: '#c084fc',
    maxTokens: 3000,
  },
];

export const AGENT_IDS: AgentId[] = AGENT_META.map((agent) => agent.id);

export function agentMetaById(id: AgentId): AgentMeta | undefined {
  return AGENT_META.find((agent) => agent.id === id);
}
