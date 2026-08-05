import { useRef, useState } from 'react';
import type * as React from 'react';
import { isOfficeFile } from '../../harness/file';
import { useWorkspace } from '../state/workspace-context';
import { importWorkspaceFile } from './file-service';

export type FileImportController = ReturnType<typeof useFileImport>;

export interface FileImportProgress {
  completed: number;
  total: number;
  fileName: string;
}

export type FileImportNotice =
  | { kind: 'session-required' }
  | { kind: 'result'; imported: number; office: number; unsupported: number; failed: number };

export function useFileImport() {
  const { activeId, setActiveTab } = useWorkspace();
  const [fileDrop, setFileDrop] = useState(false);
  const [dropNotice, setDropNotice] = useState<FileImportNotice | null>(null);
  const [importProgress, setImportProgress] = useState<FileImportProgress | null>(null);
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const folderRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);

  const ingestFiles = async (files: File[]) => {
    if (!files.length) return;
    if (!activeId) {
      setDropNotice({ kind: 'session-required' });
      return;
    }
    let ok = 0, office = 0, unsupported = 0, failed = 0;
    setImportProgress({ completed: 0, total: files.length, fileName: files[0].name });
    for (const [index, file] of files.entries()) {
      setImportProgress({ completed: index, total: files.length, fileName: file.name });
      try {
        const relative = ((file as any).webkitRelativePath || file.name).replace(/\\/g, '/').replace(/^\/+/, '');
        const result = await importWorkspaceFile(activeId, file, relative === file.name ? undefined : relative);
        if (result.ok) {
          ok++;
          if (isOfficeFile(file.name)) office++;
        } else if (result.error === 'unsupported binary') unsupported++;
        else failed++;
      } catch { failed++; }
      finally { setImportProgress({ completed: index + 1, total: files.length, fileName: file.name }); }
    }
    setDropNotice({ kind: 'result', imported: ok, office, unsupported, failed });
    window.setTimeout(() => setImportProgress(null), 650);
    window.setTimeout(() => setDropNotice(null), 3000);
  };

  const onFileDrop = async (event: React.DragEvent) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setFileDrop(false);
    await setActiveTab('files');
    await ingestFiles(Array.from(event.dataTransfer?.files || []));
  };
  const onWorkspaceDragEnter = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setFileDrop(true);
  };
  const onWorkspaceDragLeave = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setFileDrop(false);
  };

  return { fileDrop, dropNotice, importProgress, uploadRef, folderRef, ingestFiles, onFileDrop, onWorkspaceDragEnter, onWorkspaceDragLeave };
}
