/**
 * dsh-wb-schema-form-shim — host-side mount point (no-op).
 * The real work is the browser client module (../client.js) which registers
 * "@deepseek-ai/dsh-client-schema-form" so built-in @deepseek-ai/dsh-client-ui-settings
 * can resolve its require at runtime. Fixes the ui-settings loader failure.
 */
export const name = "dsh-wb-schema-form-shim";
export const inject = [];
export function apply() {
  // Host side does nothing; the client bundle provides the schema-form module.
}
