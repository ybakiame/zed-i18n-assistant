import { resolvePackageContext, resolveProjectContext } from '../config.js';
import type { ProjectContext } from '../types.js';
import { loadConfigIfChanged } from './config-manager.js';
import { state } from './runtime.js';

// The workspace root context plus every configured monorepo `packages` entry,
// each with its own resolved root and inherited config.
export function getAllConfiguredContexts(): ProjectContext[] {
  loadConfigIfChanged();
  return [
    resolveProjectContext(state.workspaceRoot, state.workspaceRoot, state.config),
    ...state.config.packages.map((pkg) => resolvePackageContext(state.workspaceRoot, state.config, pkg)),
  ];
}
