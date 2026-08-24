# dsh-wb-schema-form-shim

A **client-module shim** that fixes a built-in DSH packaging defect in
`@deepseek-ai/dsh` `0.1.0-rc.6`.

## Problem

The built-in client module `@deepseek-ai/dsh-client-ui-settings` calls
`require("@deepseek-ai/dsh-client-schema-form")` at factory-evaluation time.
However, `dsh-client-schema-form` is **not** shipped as a browser client
module in this DSH build (no `dsh.client` declaration, no `client.js` bundle),
and its dependency tree (`schemastery` → `cosmokit`, `@standard-schema/spec`)
is never browser-bundled. So the browser fails to resolve that `require` when
materializing `ui-settings`, and the harness reports:

```
failed to import loader entry ... (@deepseek-ai/dsh-client-ui-settings):
client-modules: bundle script /plugins/@deepseek-ai/dsh-client-ui-settings/client.js?rev=... failed to load
```

This is independent of the `dsh-wb-*` WorkBuddy plugins — it is a pre-existing
built-in inconsistency.

## Fix

This package bundles the real `@deepseek-ai/dsh-client-schema-form` (inlining
its browser-safe dependencies) into a self-contained `client.js` that
registers itself under the exact id `@deepseek-ai/dsh-client-schema-form` via
`window.__ModuleLoader__.load(...)`, returning the schema-form API
(`validateDraft`, `rehydrateSchema`, etc.). Because it is registered as a
client module, `ui-settings`'s `require(...)` now resolves.

It is deployed like the other `dsh-wb-*` plugins: a `file:` dependency +
`dsh.profile.bundles` entry in the web profile, so it survives DSH restarts.
(It is a version-pinned snapshot of the built-in's schema-form; if DSH is
upgraded and ships a proper client bundle, this shim can be removed.)

## Layout

- `package.json` — `dsh.bundle` (host no-op mount) + `dsh.client` (browser).
- `lib/index.js` — host-side no-op cordis plugin (mount point only).
- `cordis.patch.yml` — host overlay inserting the bundle row.
- `client.js` — **built artifact** (esbuild bundle of the built-in schema-form).
  Regenerate with esbuild if the built-in schema-form version changes:
  ```sh
  esbuild _entry.js --bundle --format=iife --platform=browser --outfile=client.js
  # _entry.js:
  #   import * as SchemaForm from "@deepseek-ai/dsh-client-schema-form";
  #   globalThis.__ModuleLoader__.load({
  #     id: "@deepseek-ai/dsh-client-schema-form",
  #     factory: (require) => SchemaForm,
  #   });
  ```
