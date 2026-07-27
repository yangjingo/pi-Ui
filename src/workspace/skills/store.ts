import { useEffect, useSyncExternalStore } from 'react';
import { agentClient, requestJson } from '../../core/agent';
import type { Skill, SkillDraft } from './model';

let skills: Skill[] = [];
const listeners = new Set<() => void>();

function publish(next: Skill[]) {
  skills = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function refreshSkills(): Promise<Skill[]> {
  const next = await requestJson<Skill[]>('/api/skills', { errorMessage: '无法读取本地 Skills' });
  publish(next);
  return next;
}

export async function saveSkill(draft: SkillDraft): Promise<Skill> {
  const result = await requestJson<{ ok: boolean; error?: string; skill: Skill }>('/api/skills', {
    method: 'POST',
    body: draft,
    errorMessage: '保存 Skill 失败',
  });
  if (!result.ok) throw new Error(result.error || '保存 Skill 失败');
  await refreshSkills();
  return result.skill;
}

export async function deleteSkill(id: string): Promise<void> {
  const result = await requestJson<{ ok: boolean; error?: string }>(
    `/api/skills?id=${encodeURIComponent(id)}`,
    { method: 'DELETE', errorMessage: '删除 Skill 失败' },
  );
  if (!result.ok) throw new Error(result.error || '删除 Skill 失败');
  await refreshSkills();
}

export function createSkillFromTurn(messageIndex: number) {
  return agentClient.createSkillFromTurn(messageIndex);
}

export function useSkills(): Skill[] {
  const snapshot = useSyncExternalStore(subscribe, () => skills, () => skills);
  useEffect(() => { void refreshSkills().catch(() => undefined); }, []);
  return snapshot;
}
