// OpenUI 0.2.15 otherwise auto-loads a developer inspector from a remote CDN.
// Reserve its bootstrap flag before importing the renderer so the localhost
// app uses only the installed runtime, without an inspector or remote scripts.
const runtime = globalThis as typeof globalThis & { [key: symbol]: unknown };
runtime[Symbol.for('openui.devtools.autoMount')] = true;

export {};
