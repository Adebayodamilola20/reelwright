/**
 * Ambient declaration for CSS imports (bundler-style, e.g. Vite/Electron).
 * The renderer bundler resolves `import "./x.css"`; TypeScript needs this
 * stub so those imports typecheck. Shared by every view module in the app.
 */

declare module "*.css";
