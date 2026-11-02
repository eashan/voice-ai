// Usage: npx tsx scripts/gen-concierge-prompt.ts [--check]
// Builds apps/orchestrator/agents/portfolio-concierge.prompt.md from the hand-written rules template and the
// knowledge in apps/web/content/profile.ts (the single source of truth). Commit the output: the orchestrator image
// doesn't include apps/web. --check exits 1 if the committed prompt is out of date.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { PROFILE } from "../apps/web/content/profile";

const AGENTS = new URL("../apps/orchestrator/agents/", import.meta.url);
const TEMPLATE = new URL("portfolio-concierge.template.md", AGENTS);
const OUT = new URL("portfolio-concierge.prompt.md", AGENTS);

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
if (!template.includes("{{KNOWLEDGE}}")) throw new Error("template is missing {{KNOWLEDGE}}");
const prompt = template.replace("{{KNOWLEDGE}}", knowledge());

if (/\+91|\b\d{5}\s?\d{5}\b/.test(prompt)) throw new Error("prompt looks like it contains a phone number");

if (process.argv.includes("--check")) {
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (current !== prompt) {
    console.error("portfolio-concierge.prompt.md is out of date: run npx tsx scripts/gen-concierge-prompt.ts");
    process.exit(1);
  }
  console.log("concierge prompt is up to date");
} else {
  writeFileSync(OUT, prompt);
  console.log(`wrote ${OUT.pathname} (${prompt.length} chars)`);
}
