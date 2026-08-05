import { useEffect, useSyncExternalStore } from 'react';
import { agentClient, requestJson } from '../../core/agent';
import type { Skill, SkillDraft } from './model';

let skills: Skill[] = [];
const listeners = new Set<() => void>();
const SKILL_CACHE_TTL_MS = 30_000;
let catalogLoadedAt = 0;
let catalogRequest: Promise<Skill[]> | null = null;
const detailLoadedAt = new Map<string, number>();
const detailRequests = new Map<string, Promise<Skill>>();

function publish(next: Skill[]) {
  skills = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function refreshSkills(force = false): Promise<Skill[]> {
  if (!force && catalogLoadedAt && Date.now() - catalogLoadedAt < SKILL_CACHE_TTL_MS) return skills;
  if (catalogRequest) return catalogRequest;
  catalogRequest = requestJson<Skill[]>('/api/skills', { errorMessage: '无法读取本地 Skills' })
    .then(next => {
      const merged = next.map(summary => {
        const detail = skills.find(skill => skill.id === summary.id && detailLoadedAt.has(skill.id));
        return detail ? { ...summary, files: detail.files } : summary;
      });
      catalogLoadedAt = Date.now();
      publish(merged);
      return merged;
    })
    .finally(() => { catalogRequest = null; });
  return catalogRequest;
}

export async function loadSkill(id: string, force = false): Promise<Skill> {
  const cached = skills.find(skill => skill.id === id);
  const loadedAt = detailLoadedAt.get(id) || 0;
  if (!force && cached && loadedAt && Date.now() - loadedAt < SKILL_CACHE_TTL_MS) return cached;
  const pending = detailRequests.get(id);
  if (pending) return pending;
  const request = requestJson<Skill>(`/api/skills?id=${encodeURIComponent(id)}`, {
    errorMessage: '无法读取 Skill 内容',
  }).then(detail => {
    detailLoadedAt.set(id, Date.now());
    publish(cached
      ? skills.map(skill => skill.id === id ? detail : skill)
      : [...skills, detail].sort((a, b) => a.name.localeCompare(b.name)));
    return detail;
  }).finally(() => { detailRequests.delete(id); });
  detailRequests.set(id, request);
  return request;
}

export async function saveSkill(draft: SkillDraft): Promise<Skill> {
  const result = await requestJson<{ ok: boolean; error?: string; skill: Skill }>('/api/skills', {
    method: 'POST',
    body: draft,
    errorMessage: '保存 Skill 失败',
  });
  if (!result.ok) throw new Error(result.error || '保存 Skill 失败');
  detailLoadedAt.set(result.skill.id, Date.now());
  const catalog = await requestJson<Skill[]>('/api/skills', { errorMessage: '无法刷新本地 Skills' });
  catalogLoadedAt = Date.now();
  publish(catalog.map(skill => skill.id === result.skill.id ? result.skill : skill));
  return result.skill;
}

export async function deleteSkill(id: string): Promise<void> {
  const result = await requestJson<{ ok: boolean; error?: string }>(
    `/api/skills?id=${encodeURIComponent(id)}`,
    { method: 'DELETE', errorMessage: '删除 Skill 失败' },
  );
  if (!result.ok) throw new Error(result.error || '删除 Skill 失败');
  detailLoadedAt.delete(id);
  detailRequests.delete(id);
  catalogLoadedAt = 0;
  await refreshSkills(true);
}

export async function createSkillFromTurn(sessionId: string, messageIndex: number) {
  return agentClient.createSkillFromTurn(sessionId, messageIndex);
}

export function useSkills(): Skill[] {
  const snapshot = useSyncExternalStore(subscribe, () => skills, () => skills);
  useEffect(() => {
    void refreshSkills().catch(() => undefined);
    return agentClient.subscribe(event => {
      if (event.type === 'skills_changed') void refreshSkills(true).catch(() => undefined);
    });
  }, []);
  return snapshot;
}
