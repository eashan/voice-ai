// Usage: npx tsx scripts/gen-concierge-prompt.ts [--check]
// Builds apps/orchestrator/agents/portfolio-concierge.prompt.md from the hand-written rules template and the
// knowledge in apps/web/content/profile.ts (the single source of truth). Commit the output: the orchestrator image
// doesn't include apps/web. --check exits 1 if the committed prompt is out of date.
// Also writes the playground split: .persona.md (the template above "# Knowledge", what visitors can edit) and
// .knowledge.md (the locked facts appended after an edited persona).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { PROFILE } from "../apps/web/content/profile";

const AGENTS = new URL("../apps/orchestrator/agents/", import.meta.url);
const TEMPLATE = new URL("portfolio-concierge.template.md", AGENTS);
const OUT = new URL("portfolio-concierge.prompt.md", AGENTS);
const PERSONA_OUT = new URL("portfolio-concierge.persona.md", AGENTS);
const KNOWLEDGE_OUT = new URL("portfolio-concierge.knowledge.md", AGENTS);
const KNOWLEDGE_HEADING = "# Knowledge\n\n{{KNOWLEDGE}}";

const list = (items: string[]) => items.map((i) => `- ${i}`).join("\n");

function knowledge(): string {
  const roles = PROFILE.roles.map((r) => {
    const head = `### ${r.title}, ${r.company} (${r.dates.replace("–", "to")})`;
    return [head, r.about, list([...r.bullets, ...(r.concierge ?? [])])].filter(Boolean).join("\n");
  });
  return [
    "## Summary",
    `Based in ${PROFILE.location}. ${PROFILE.summary}`,
    "",
    "## Experience",
    "",
    roles.join("\n\n"),
    "",
    "## Education",
    list(PROFILE.education.map((e) => `${e.school}: ${e.detail}.`)),
    "",
    "## Skills",
    [...PROFILE.skills, ...PROFILE.conciergeSkills].join(", ") + ".",
    "",
    "## Achievements",
    list(PROFILE.achievements),
    "",
    "## Projects",
    list(PROFILE.projects.map((p) => `${p.name}: ${p.detail}`)),
  ].join("\n");
}

const template = readFileSync(TEMPLATE, "utf8");
if (!template.trimEnd().endsWith(KNOWLEDGE_HEADING)) {
  throw new Error(`template must end with "${KNOWLEDGE_HEADING.replace("\n\n", " ")}"`);
}
const prompt = template.replace("{{KNOWLEDGE}}", knowledge());
const persona = template.slice(0, template.lastIndexOf("# Knowledge")).trimEnd() + "\n";
const knowledgeBlock = KNOWLEDGE_HEADING.replace("{{KNOWLEDGE}}", knowledge()) + "\n";

if (/\+91|\b\d{5}\s?\d{5}\b/.test(prompt)) throw new Error("prompt looks like it contains a phone number");

const outputs: Array<[URL, string]> = [
  [OUT, prompt],
  [PERSONA_OUT, persona],
  [KNOWLEDGE_OUT, knowledgeBlock],
];
if (process.argv.includes("--check")) {
  const stale = outputs.filter(([url, text]) => (existsSync(url) ? readFileSync(url, "utf8") : "") !== text);
  if (stale.length) {
    for (const [url] of stale) console.error(`${url.pathname.split("/").pop()} is out of date`);
    console.error("run: npx tsx scripts/gen-concierge-prompt.ts");
    process.exit(1);
  }
  console.log("concierge prompt files are up to date");
} else {
  for (const [url, text] of outputs) {
    writeFileSync(url, text);
    console.log(`wrote ${url.pathname} (${text.length} chars)`);
  }
}
