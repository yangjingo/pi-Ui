import { fileTypeOf } from './contracts';
import type { Artifact } from './types';

/** Strip @mentions from transcript text while preserving them as visible user attachments. */
export function visiblePrompt(source: string): { text: string; attachments: Artifact[] } {
  const attachments: Artifact[] = [];
  const seen = new Set<string>();
  const cleaned = source.replace(/@(?:"([^"]+)"|([\w一-龥.\/\\-]+))/g, (_full, quoted: string | undefined, bare: string | undefined) => {
    const path = quoted || bare || '';
    if (path && !seen.has(path)) {
      seen.add(path);
      attachments.push({ name: path.replace(/\\/g, '/').split('/').pop() || path, path, type: fileTypeOf(path), label: '引用' });
    }
    return ' ';
  }).replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return { text: cleaned || (attachments.length ? '引用工作区文件' : source), attachments };
}
