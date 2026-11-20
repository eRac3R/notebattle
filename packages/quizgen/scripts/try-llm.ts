/**
 * Dev tool: run the real generation pipeline on a file and print a quality summary.
 *   NOTEBATTLE_LLM_BASE_URL=... NOTEBATTLE_LLM_MODEL=... NOTEBATTLE_LLM_API_KEY=... tsx scripts/try-llm.ts <file> [count]
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { generateDeck, llmFromEnv } from "../src/index.js";

const file = process.argv[2] ?? new URL("../../../samples/os-notes.pdf", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const count = Number(process.argv[3] ?? 10);
const llm = llmFromEnv();
console.log(`model: ${llm?.label ?? "offline"} · file: ${basename(file)} · target: ${count}`);
for await (const ev of generateDeck(readFileSync(file), { llm, count, filename: basename(file) })) {
  if (ev.type === "question") {
    const q = ev.question;
    console.log(`\n✓ [${q.topic}] ${q.prompt}`);
    q.choices.forEach((c, i) => console.log(`   ${i === q.answer ? "*" : " "} ${"ABCD"[i]}. ${c}`));
    console.log(`   evidence (${q.sourceRef}): "${q.evidence}"${ev.flags.length ? `  flags: ${ev.flags.join(",")}` : ""}`);
  } else if (ev.type === "rejected") console.log(`\n✗ REJECTED (${ev.reason}): ${ev.prompt}`);
  else console.log(`\n· ${JSON.stringify(ev)}`);
}
