import nextTs from "eslint-config-next/typescript";

// Reuse the monorepo's installed TypeScript lint rules; no Next.js runtime in the extension.
export default [...nextTs, { ignores: [".wxt/**", ".output/**"] }];
