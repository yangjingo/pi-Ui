/** Public browser Workspace boundary. Canvas imports business state and actions only here. */
export { WorkspaceProvider, useWorkspace } from './state/workspace-context';
export type { View, WorkspaceCtx } from './state/workspace-context';

export { filterFileTree, listFiles, parentPath } from './files/tree';
export { basename, buildFileTree, countFiles, findFileInSession, parseCSV, pathOf } from './files/workspace';
export { useFileImport } from './files/use-file-import';
export type { FileImportController, FileImportProgress } from './files/use-file-import';
export {
  fetchWorkspaceFileBlob,
  importWorkspaceFile,
  subscribeWorkspaceEvents,
  workspaceFileType,
  workspaceFileUrl,
} from './files/file-service';
export type { ImportedWorkspaceFile } from './files/file-service';
export {
  extractOfficePreview,
  isOfficeFile,
  isOfficeWorkbookFile,
  isOfficeWorkbookPreview,
  OFFICE_EXTENSIONS,
} from '../harness/file';
export type { OfficeWorkbookPreview } from '../harness/file';

export { deleteSkill, refreshSkills, saveSkill, useSkills, createSkillFromTurn } from './skills/store';
export { makeSkillMd, skillSlashCommand } from './skills/model';
export type { Skill, SkillDraft } from './skills/model';

export { modelService } from './models/model-service';
export type {
  CustomModelEntry,
  ModelConfigFile,
  ModelOption,
  ModelTestResult,
  UpdateModelEntry,
} from '../core/agent/protocol';
