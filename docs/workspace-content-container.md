# Workspace content container

The desktop workspace uses one renderer-side container for both the `right` and `bottom` panels. It does not change the Codex App Server, preload bridge, or main-process workspace APIs.

## Tab records and runtime

`workspace-container/workspaceTypes.ts` separates persistent tab records from temporary runtime data:

- `WorkspaceTabRecord` is JSON-safe: id, kind, title, props, preview and close flags.
- `WorkspacePanelState` owns order, active tab, MRU history, open state, size and maximized state.
- `WorkspaceTabRuntime` holds renderer-only resource IDs such as terminal session and browser view IDs. It is never persisted.

Workspace state is stored as `workspace-container:v2:<conversation-id>`. The provider reads the former `right-workspace:<scope>` state as a one-way compatibility migration and leaves the old key in place for rollback.

## Content adapters

`WorkspaceContentRegistry` maps a tab `kind` to its existing Files, Terminal, Browser, or Review component. Adapters also own lifecycle cleanup:

- terminal tab close kills its existing PTY;
- browser tab close destroys its existing view;
- panel movement keeps runtime IDs and calls move lifecycle hooks instead of close hooks.

To add a new content kind, register an adapter with `render`, and add `onClose` or `onMove` only when the content owns a renderer-visible resource. Do not put React components, Electron handles, credentials, absolute paths, scrollback, or browser history into a tab record.

## Commands and panel behavior

`WorkspacePanelController` performs preview replacement, terminal-close confirmation, bulk close, and cross-panel moves around the pure reducer. A rejected confirmation leaves the full batch untouched. Right and bottom use the same `WorkspacePanelShell` and `WorkspaceTabStrip`; the former right-workspace exports remain compatibility facades for existing callers.

File selection opens a preview. Double-clicking a file or tab pins it. Preview interaction inside content pins the tab, while file tree and search selection are explicitly exempt so browsing files can continue replacing the preview slot.
