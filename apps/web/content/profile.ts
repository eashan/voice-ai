/**
 * Single source of truth for Eashan's profile.
 *
 * - `bullets`, `summary`, `skills`, `education`, `achievements`: VERBATIM from the résumé (docs/portfolio-assets/Eashan_Kadam_Resume.pdf).
 *   Order within a role puts the strongest two first; the page shows those two and folds the rest behind "Show N more".
 * - `concierge`: true facts that only the voice concierge uses (not shown on the page). Taken from the
 *   pre-existing concierge prompt (apps/orchestrator/agents/portfolio-concierge.prompt.md).
 * - Never put a phone number in here.
 */
import { CONTACT } from "./contact";

export interface Role {
  id: string;
  company: string;
  title: string;
  dates: string;
  /** One headline number for the timeline pill. */
  metric?: string;
  /** Résumé bullets, verbatim. */
  bullets: string[];
  /** Short company context for the concierge. */
  about?: string;
  /** Extra facts for the concierge only. */
  concierge?: string[];
}

export interface Education {
  school: string;
  detail: string;
}

export interface Project {
  name: string;
  detail: string;
}

export const PROFILE = {
  name: "Eashan Kadam",
  location: "Mumbai, India",
  headline: "AI Product Manager | AI Voice Agents, Debt Collection & Insurance Voice Bots, Fintech Automation, LLM Evals",
  /** First sentence of the résumé summary: the /experience intro. */
  intro:
    "AI Product Manager with 5+ years of product management and 3 years of software development, most of it spent building voice AI agents for enterprise B2B SaaS customers.",
  summary:
    "AI Product Manager with 5+ years of product management and 3 years of software development, most of it spent building voice AI agents for enterprise B2B SaaS customers. Took JustCall's AI Voice Agent from 0→1 to about $1M ARR, and led a team of 3 PMs at Skit.ai building ~10 voice agents for debt collection, insurance renewal, and lead qualification. Owned the roadmap for Kodo's fintech Procure-to-Pay (P2P) platform, built LLM evals and guardrails into the AI products shipped, and lifted trial user activation 25% (relative).",
  /** Home hero (Home artboard). */
  tagline: "AI Product Manager · AI Voice Agents · Fintech Automation · LLM Evals",
  pitch:
    "5+ years in product, 3 writing code. I took JustCall's AI Voice Agent from 0→1 to about $1M ARR, and now build agentic fintech workflows at Kodo.",
  /** Highlights strip: every number is from the résumé. */
  highlights: [
    { value: "~$1M ARR", label: "JustCall AI Voice Agent, 0→1" },
    { value: "$450K", label: "Contracted ARR from 4 voice-agent pilots, Skit.ai" },
    { value: "+25%", label: "Trial user activation, Kodo Reporting Agent" },
    { value: "80%", label: "Faster go-live for debt-collection voice agents" },
  ],
  contact: CONTACT,
  /** Phone-free web copy of the résumé. null until one exists (the original PDF has the phone number). */
  resumePdf: null as string | null,

  roles: [
    {
      id: "kodo",
      company: "Kodo",
      title: "AI Product Manager",
      dates: "Apr 2025 – Present",
      metric: "+25% trial activation",
      about: "Kodo is a fintech procure-to-pay SaaS platform for enterprise finance teams in India.",
      bullets: [
        "Designed an agentic AI workflow that reads invoices, classifies each line item, and raises approval requests for Accounts Payable (AP) teams; it featured in the pitch for 5 new deals worth over $100K ARR combined.",
        "Shipped a chat-based Reporting Agent that builds reports for CFOs using retrieval-augmented generation (RAG); lifted trial user activation 25% (relative).",
        "Built LLM evals that set a quality baseline for the invoice workflow to test every change against, and evals for the corporate treasury product being launched.",
        "Owned the product roadmap for Kodo's fintech P2P automation platform, turning finance teams' pain points into PRDs, UX decisions, and scope engineers could build from right away.",
        "Introduced 2-week sprints, backlog grooming, and clear user stories and acceptance criteria, cutting time-to-live by 40%.",
        "Used AI across the product workflow: analysed customer usage data with Claude Cowork to measure outcomes, drafted PRDs with custom Claude agents, and built working prototypes with Claude Code.",
      ],
      concierge: ["Also uses Lovable and Figma Make for design prototypes."],
    },
    {
      id: "consulting",
      company: "AI Transformation Consulting",
      title: "Independent AI Consultant (Part-time)",
      dates: "Aug 2026 – Present",
      metric: "~87% recipe match",
      about: "A side practice building custom agentic AI solutions.",
      bullets: [
        "Built an AI assistant that suggests starting recipes to a paint manufacturer's chemists, drawing on years of past lab data.",
        "On 10 past batches, it matched ~87% of chemists' real recipes (vs. ~42% baseline), cutting search from hours to minutes.",
      ],
      concierge: [
        "The client is an industrial paint and coatings manufacturer; the assistant turns years of legacy recipes and R&D trial data into a chat assistant for chemists.",
        "The ~42% baseline is a random recipe from the same product family.",
        'Architecture principle: "tools compute, model reasons". Deterministic tools handle retrieval, blending, rebalancing and rule validation so every number traces to a tool result; a validator blocks invalid recipes.',
        "Built a nightly read-only data pipeline joining the legacy formulation database with the R&D lab notebook, including failed trials.",
        "Cut model cost per recipe by about 93%, from about $1.30 to about 9 cents, using conversation caching, tool-call consolidation and routing routine turns to a smaller model.",
      ],
    },
    {
      id: "justcall",
      company: "JustCall (SaaS Labs)",
      title: "Product Manager, AI Voice Agent & JustCall AI",
      dates: "Mar 2023 – Mar 2025",
      metric: "~$1M ARR, 0→1",
      about: "JustCall is a cloud phone system for sales and support teams.",
      bullets: [
        "Led the 0→1 build of JustCall's own AI Voice Agent on top of a third-party voice platform, growing a new AI revenue stream to about $1M ARR, including an ~$800K enterprise deal.",
        "Ran a beta for an appointment-booking voice agent that drew 500+ access requests and 100+ active customers, then launched v1 in November 2024 with their feedback built in; 50+ customers signed up and paid within 2 months, adding ~$100K ARR.",
        "Launched AI Coaching, which scores agents' calls against configurable scorecards, helping win $500K+ ARR in enterprise AI plans (FY23-24).",
        "Built APIs and webhooks that send call data into customers' own workflows via Zapier, a key factor in 5 large (50+ seat) deals in 2024; launched AI-generated call chapters that cut supervisors' review effort and closed a $100K ARR deal.",
        "Owned the Voice Agent roadmap (call routing, knowledge-based answers, webhooks, post-call analytics) with guardrails on each release, prioritizing each release through customer interviews and feedback.",
        "Organised sales, support, and solution engineering enablement to drive adoption of new Voice Agent capabilities.",
      ],
      concierge: [
        "Revamped Agent Assist with a dynamic knowledge configuration journey: a $20K ARR increase in Q3 2023.",
        "The call-chapters deal closed in Q1 2025.",
        "Won the internal GenAI Product Hackathon in October 2024 with a mobile-first AI concept for real-estate agents.",
      ],
    },
    {
      id: "skit",
      company: "Skit.ai",
      title: "Product Manager (Applications)",
      dates: "Nov 2021 – Jan 2023",
      metric: "$450K contracted ARR",
      about: "Skit.ai automates contact-center voice communications. Based in Bengaluru.",
      bullets: [
        "Led a team of 3 PMs to build ~10 ready-to-deploy voice agents for debt collection, insurance renewal, lead qualification, and feedback calls; ran 4 pilots that turned into $450K in contracted ARR.",
        "Cut go-live time for debt-collection voice agents by 80%, to under 2 weeks, through better productization, onboarding guides, and implementation discipline.",
        "Designed the Digital Experience Center, a standard way for prospects to try the product, raising lead qualification ~30%.",
        "Used call data to improve how many calls connected, how engaged callers stayed, and how many calls the agent finished without a human; widened the agents' understanding of what callers asked for and said in live calls.",
      ],
      concierge: ["Reached 60% connectivity and engagement and 45% containment at go-live by improving intent and entity coverage."],
    },
    {
      id: "engagely",
      company: "Engagely AI (Exponentia.ai)",
      title: "Lead Product Manager, Pre-Sales",
      dates: "Oct 2020 – Nov 2021",
      metric: "60% POC conversion",
      about: "Based in Mumbai.",
      bullets: [
        "Defined the go-to-market (GTM) and customer-solutioning strategy that made the voice bot the main enterprise revenue driver across major US and APAC accounts.",
        "Ran 40+ proofs of concept (POCs) with a 60% conversion rate; launched real-time translation, bot recommendations, and agent assist, helping win a $200K ARR client.",
      ],
      concierge: [
        "Owned the spec, design and development of the voice bot's interruption-handling feature.",
        "Promoted to Lead PM in 8 months; recognized as a subject-matter expert on voice AI and conversational AI.",
        "The $200K ARR client was in the US.",
      ],
    },
    {
      id: "citicorp",
      company: "Citicorp",
      title: "Assistant Manager 2",
      dates: "Jun 2016 – Mar 2019",
      metric: "45% faster access",
      about: "Based in Pune; worked on Citi Private Bank systems.",
      bullets: [
        "Built an internal event-driven messaging system that cut access time to legacy systems by 45%, with reusable components saving an estimated $100K-$200K a year.",
      ],
      concierge: [
        "The data infrastructure behind the 45% cut was graph-database based.",
        "Led a team of 3 on Citi Private Bank's first project performance dashboard; won a process-improvement challenge and a platinum recognition from the global CEO of Citi Private Bank.",
      ],
    },
  ] satisfies Role[] as Role[],

  education: [
    {
      school: "Indian School of Business",
      detail: "Post Graduate Program in Management, full-time (Marketing and IT Management), 2020",
    },
    { school: "Veermata Jijabai Technological Institute", detail: "Bachelor of Technology (IT), 2016" },
  ] satisfies Education[] as Education[],

  achievements: [
    "Won an internal GenAI Product Hackathon at SaaS Labs for a mobile-first real-estate AI assistant.",
    "Built Quickey Keyboard, a zero-UI keyboard startup accepted into the IGNITE program with a 10 lac seed fund.",
  ],

  /** Display labels (résumé list, shortened where the artboard shortens). */
  skills: [
    "AI voice/chat agents",
    "Agentic systems",
    "LLM evals & guardrails",
    "Prompt engineering",
    "Vector databases",
    "Generative AI",
    "Python",
    "SQL",
    "Claude Code",
    "Claude Cowork",
    "Lovable",
    "Figma Make",
    "Zapier/N8N",
    "UAT",
    "Jira/Confluence",
  ],
  conciergeSkills: ["RAG pipelines", "API design", "UX design", "copilots", "AWS and Azure"],

  /** Concierge-only. */
  projects: [
    {
      name: "VoiceForge",
      detail:
        "A real-time voice agent builder (streaming speech-to-text, Claude, text-to-speech) with per-turn latency visibility. This site's voice demos run on it.",
    },
    {
      name: "Quickey Keyboard",
      detail:
        "Zero-UI Android keyboard startup with payment and e-commerce plugins; accepted into the IGNITE program with a 10 lakh rupee seed fund. Eashan led product and a team of 5 developers from prototype to MVP in 3 months.",
    },
    { name: "Research", detail: 'Co-authored "Deep Residual Networks with Exponential Linear Unit" (2016), cited 115+ times.' },
    {
      name: "Zomato POS concept",
      detail: "Designed and pitched a point-of-sale system concept for Zomato during a product management certification with Upgrad.",
    },
  ] satisfies Project[] as Project[],
};
