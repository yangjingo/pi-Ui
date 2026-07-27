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

export function useFileImport() {
  const { setActiveTab } = useWorkspace();
  const [fileDrop, setFileDrop] = useState(false);
  const [dropMsg, setDropMsg] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<FileImportProgress | null>(null);
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);

  const ingestFiles = async (files: File[]) => {
    if (!files.length) return;
    let ok = 0, office = 0, unsupported = 0, failed = 0;
    setImportProgress({ completed: 0, total: files.length, fileName: files[0].name });
    for (const [index, file] of files.entries()) {
      setImportProgress({ completed: index, total: files.length, fileName: file.name });
      try {
        const result = await importWorkspaceFile(file);
        if (result.ok) {
          ok++;
          if (isOfficeFile(file.name)) office++;
        } else if (result.error === 'unsupported binary') unsupported++;
        else failed++;
      } catch { failed++; }
      finally { setImportProgress({ completed: index + 1, total: files.length, fileName: file.name }); }
    }
    const details = [office ? `其中 ${office} 个 Office 文件` : '', unsupported ? `跳过 ${unsupported} 个不支持的二进制文件` : '', failed ? `${failed} 个写入失败` : ''].filter(Boolean).join('，');
    setDropMsg(`${ok ? `已导入 ${ok} 个文件` : '未能导入文件'}${details ? `，${details}` : ''}`);
    window.setTimeout(() => setImportProgress(null), 650);
    window.setTimeout(() => setDropMsg(null), 3000);
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

  return { fileDrop, dropMsg, importProgress, uploadRef, ingestFiles, onFileDrop, onWorkspaceDragEnter, onWorkspaceDragLeave };
}
