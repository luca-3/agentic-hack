// Self-check for chunkText: npx tsx apps/dashboard/scripts/chunk-check.ts
import assert from "node:assert/strict";
import { KNOWLEDGE_LIMITS } from "@lotse/shared";
import { chunkText } from "../src/lib/chunk";

assert.deepEqual(chunkText("  \n\n "), []);
assert.deepEqual(chunkText("Hallo\n\nWelt"), ["Hallo\n\nWelt"]);
const md = "# Urlaub\nAntrag im Portal.\n\nChef gibt frei.\n## Krank\nBis 9 Uhr melden.";
assert.deepEqual(chunkText(md), ["# Urlaub\nAntrag im Portal.\n\nChef gibt frei.", "## Krank\nBis 9 Uhr melden."]);
const lang = chunkText(`# Lang\n${"wort ".repeat(1000)}`, 100);
assert.ok(lang.length > 1 && lang.every((c) => c.startsWith("# Lang\n") && c.length <= 100));
assert.ok(chunkText("x".repeat(9000), 99_999).every((c) => c.length <= KNOWLEDGE_LIMITS.maxChunkChars));
console.log("chunk-check ok");
