// UI/UX layer — icon glyphs and type→icon mappings. Presentation only.
import type { FileType } from '../core/agent/protocol';

export const ICONS: Record<string, string> = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>',
  spark: '<path d="M12 3l1.7 4.6L18 9.3l-4.3 1.7L12 15.6l-1.7-4.6L6 9.3l4.3-1.7L12 3Z"/>',
  brain: '<path d="M9 3a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 3 3 2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Z"/><path d="M15 3a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-3 3 2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/>',
  share: '<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  send: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/>',
  'text-file': '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  frame: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
  'web-preview': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M10 12l-2 2 2 2M14 12l2 2-2 2"/><circle cx="6" cy="6.5" r=".5" fill="currentColor" stroke="none"/>',
  code: '<path d="m8 6-6 6 6 6M16 6l6 6-6 6"/>',
  braces: '<path d="M9 4H7a2 2 0 0 0-2 2v3a3 3 0 0 1-2 3 3 3 0 0 1 2 3v3a2 2 0 0 0 2 2h2M15 4h2a2 2 0 0 1 2 2v3a3 3 0 0 0 2 3 3 3 0 0 0-2 3v3a2 2 0 0 1-2 2h-2"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"/>',
  thumbs: '<path d="M7 10v11M18 21H7l-3-8h4l2-9a2 2 0 0 1 2 2v5h4a2 2 0 0 1 2 2l-2 6Z"/>',
  trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
  pencil: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 17v-4M12 17V8M17 17v-6"/>',
  route: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.5 6H15a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h6.5"/>',
  target: '<circle cx="11" cy="13" r="7"/><circle cx="11" cy="13" r="3.5"/><circle cx="11" cy="13" r="1" fill="currentColor" stroke="none"/><path d="m14 10 7-7M17 3h4v4"/>',
  more: '<circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/>',
  settings: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/><circle cx="12" cy="12" r="3"/>',
  panel: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>',
  maximize: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>',
  minimize: '<path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5"/>',
  blocks: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  presentation: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21l4-4 4 4M8 9h8M8 12h5"/>',
  trend: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
  candle: '<rect x="4" y="8" width="3" height="10" rx="0.5"/><rect x="5" y="5" width="1" height="3"/><rect x="5" y="18" width="1" height="3"/><rect x="10" y="6" width="3" height="10" rx="0.5"/><rect x="11" y="3" width="1" height="3"/><rect x="11" y="16" width="1" height="7"/><rect x="16" y="9" width="3" height="8" rx="0.5"/><rect x="17" y="6" width="1" height="3"/><rect x="17" y="17" width="1" height="3"/>',
  wallet: '<path d="M21 12v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2"/><rect x="15" y="12" width="6" height="4" rx="1"/><circle cx="18" cy="14" r="0.5" fill="currentColor" stroke="none"/>',
  activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  gauge: '<path d="M3 12a9 9 0 1 1 18 0"/><path d="M12 7v5l3 3"/>',
};

export function Icon({ name, className = '' }: { name: string; className?: string }) {
  return (
    <svg
      className={`i${className ? ' ' + className : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      data-icon={name}
      dangerouslySetInnerHTML={{ __html: ICONS[name] || '' }}
    />
  );
}

/** One visual contract for every user-facing file intake action. */
export function FileUploadIcon({ className = '' }: { className?: string }) {
  return <Icon name="file" className={className} />;
}

/** Shared Pi identity mark. Functional controls continue to use the icon set above. */
export function PiIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={`pi-icon${className ? ' ' + className : ''}`} viewBox="0 0 800 800" aria-hidden="true" focusable="false">
      <path fill="currentColor" fillRule="evenodd" d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z" />
      <path fill="currentColor" d="M517.36 400H634.72V634.72H517.36Z" />
    </svg>
  );
}

export function fileIcon(type: FileType | string): string {
  return ({ fig: 'frame', md: 'text-file', doc: 'text-file', png: 'image', sheet: 'grid', slides: 'presentation', html: 'web-preview', code: 'code', json: 'braces', mermaid: 'route', excalidraw: 'frame', pdf: 'file', binary: 'file', folder: 'folder' } as Record<string, string>)[type as string] || 'file';
}

/** Final artifacts describe their Canvas destination as well as their file format. */
export function artifactIcon(type: FileType | string): string {
  return fileIcon(type);
}

export function trajIcon(t: string): string {
  return ({ search: 'search', read: 'eye', write: 'pencil', canvas: 'frame', plan: 'route', sheet: 'grid', query: 'database', analyze: 'chart', code: 'code', goal: 'target', think: 'brain' } as Record<string, string>)[t] || 'spark';
}
