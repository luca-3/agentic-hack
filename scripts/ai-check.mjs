// Smoke test for the Gemini setup: `npm run ai:check` (reads .env.local).
import { createGoogle } from "@ai-sdk/google";
import { embed, generateText, Output } from "ai";
import { z } from "zod";

if (!process.env.GEMINI_API_KEY) {
  console.error("✗ GEMINI_API_KEY is empty in .env.local");
  process.exit(1);
}

const google = createGoogle({ apiKey: process.env.GEMINI_API_KEY });

async function run(name, fn) {
  const start = Date.now();
  try {
    const result = await fn();
    console.log(`✓ ${name} (${Date.now() - start} ms) → ${result}`);
  } catch (e) {
    console.error(`✗ ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

await run("text  gemini-3.8-flash", async () => {
  const { text } = await generateText({ model: google("gemini-3.8-flash"), prompt: "Reply with exactly: ok" });
  return text.trim();
});

await run("json  structured output", async () => {
  const { output } = await generateText({
    model: google("gemini-3.8-flash"),
    output: Output.object({ schema: z.object({ city: z.string(), country: z.string() }) }),
    prompt: "Karlsruhe",
  });
  return JSON.stringify(output);
});

await run("embed gemini-embedding-2", async () => {
  const { embedding } = await embed({
    model: google.embedding("gemini-embedding-2"),
    value: "hello",
    providerOptions: { google: { outputDimensionality: 768 } },
  });
  return `${embedding.length} dims`;
});
