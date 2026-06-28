# desktop-app

An Electron application with React and TypeScript

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```

## Admin Backend Model Catalog

The desktop app can load the model selector list from `admin-backend` through Electron main process.

Set these environment variables before starting the app:

```bash
export ADMIN_BACKEND_URL="http://127.0.0.1:3000"
export ADMIN_BACKEND_MODEL_USER_ID="00000000-0000-0000-0000-000000000001"
export ADMIN_BACKEND_MODEL_CACHE_TTL_MS="60000"
npm run dev
```

`ADMIN_BACKEND_URL` enables the backend-backed model catalog. When it is not set, the app keeps using the Codex provider model list fallback.

`ADMIN_BACKEND_MODEL_USER_ID` is optional. When present, it is sent as `user_id` to `GET /api/client-models` so admin-backend can apply department whitelist filtering.

`ADMIN_BACKEND_MODEL_CACHE_TTL_MS` is optional and defaults to `60000`.

After one successful catalog load, the main process reuses the stale cached catalog during transient backend failures so an active desktop session can continue validating previously loaded model ids.

The backend response includes provider credentials for main-process use. Renderer IPC responses only receive the safe `CodexModelList` summary defined in `src/shared/codexIpcApi.ts`.

This integration is Phase 1. It controls the model selector list and validates selected/requested model ids. It does not route inference through backend-provided `provider`, `api_base_url`, `api_key`, or `api_format`; chat still uses the existing Codex ASP provider.

For production, `ADMIN_BACKEND_URL` must use HTTPS and `/api/client-models` must be protected by a client/device/JWT/mTLS/signature mechanism before credentials are distributed to desktop clients.
