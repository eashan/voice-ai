/**
 * Demo agents on the home page. The role brief must match the "on file" facts in each agent's prompt
 * (apps/orchestrator/agents/<id>.prompt.md): the visitor plays the customer described here.
 */
export interface Demo {
  /** Orchestrator agentId. */
  agentId: string;
  num: string;
  /** Mono id shown on the card. */
  slug: string;
  title: string;
  body: string;
  market: string;
  agentName: string;
  company: string;
  /** Shown inside the call orb. */
  initials: string;
  role: { who: string; facts: string };
  tryThis: string[];
}

export const DEMOS: Demo[] = [
  {
    agentId: "agent_debt_collection",
    num: "01",
    slug: "debt-collection",
    title: "Debt collection agent",
    body: "Payment reminder, plan negotiation and dispute handling, with identity check and disclosures first.",
    market: "India",
    agentName: "Riya",
    company: "Brightline Finance",
    initials: "riya",
    role: {
      who: "You're Rahul Mehta.",
      facts: "Date of birth 4 March 1992. Your personal-loan EMI of ₹8,000 was due on the 10th of last month, and you've missed it.",
    },
    tryThis: ["ask for a payment plan", "say you already paid", "give the wrong date of birth", "interrupt Riya mid-sentence"],
  },
  {
    agentId: "agent_insurance_support",
    num: "02",
    slug: "insurance-support",
    title: "Insurance support agent",
    body: "Policy questions, first notice of loss and renewal callbacks.",
    market: "India",
    agentName: "Sameer",
    company: "Saptarishi General Insurance",
    initials: "sameer",
    role: {
      who: "You're Ananya Iyer.",
      facts: "Your Hyundai i20 (policy ending 3307) was rear-ended at a signal in Pune yesterday. No one was hurt; the car is drivable.",
    },
    tryThis: ["start a claim", "ask if the claim will be approved", "ask what zero depreciation covers"],
  },
  {
    agentId: "agent_roofing_support",
    num: "03",
    slug: "roofing-support",
    title: "Roofing support agent",
    body: "Lead qualification, storm-damage intake and inspection booking.",
    market: "US",
    agentName: "Jo",
    company: "Pecan Hollow Roofing",
    initials: "jo",
    role: {
      who: "You're Chris Walker, a homeowner in Austin, Texas.",
      facts: "Tonight's hailstorm damaged your roof and water is dripping through the ceiling right now.",
    },
    tryThis: ["say water is coming in now", "ask how much a new roof costs", "book an inspection instead"],
  },
];
