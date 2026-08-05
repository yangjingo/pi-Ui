import { modelService, refreshSkills, type View } from '../../workspace';

const preloadRequests = new Map<View, Promise<unknown>>();

/** Warm small route chunks and their read-only catalogs without changing the active view. */
export function preloadConfigView(view: View): Promise<unknown> | undefined {
  if (view !== 'model' && view !== 'skill') return undefined;
  const pending = preloadRequests.get(view);
  if (pending) return pending;
  const request = view === 'model'
    ? Promise.all([import('./model-panel'), modelService.prefetchModels()])
    : Promise.all([import('./skill-panel'), refreshSkills()]);
  preloadRequests.set(view, request);
  const clear = () => {
    if (preloadRequests.get(view) === request) preloadRequests.delete(view);
  };
  request.then(clear, clear);
  return request;
}
