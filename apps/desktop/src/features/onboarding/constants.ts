export const WORK_TYPE_OPTIONS = [
  "Design",
  "Designing",
  "Software Development",
  "Coding",
  "Engineering",
  "Marketing",
  "Data Analysis",
  "Content Creation",
  "Research",
  "Studying",
  "Writing",
  "Founder",
  "Operations",
  "Meetings & Communication",
  "Product Management",
  "Project Management",
  "Data Science",
  "Sales",
  "Trading",
  "Consulting",
  "Customer Service",
  "Teaching",
  "Healthcare",
  "Legal",
  "Finance",
  "Other",
] as const;

export const MAIN_ACTIVITY_OPTIONS = [
  "Coding",
  "Designing",
  "Writing",
  "Researching",
  "Studying",
  "Data Analysis",
  "Marketing",
  "Sales",
  "Trading",
  "Content Creation",
  "Meetings & Communication",
  "Project Management",
  "Operations",
  "Other",
] as const;

export const MAX_MAIN_ACTIVITY_SELECTIONS = 5;

export const WORK_DOMAIN_OPTIONS = [
  "Tech",
  "SaaS",
  "AI",
  "Fashion",
  "Beauty",
  "Cosmetics",
  "Education",
  "Research",
  "Media",
  "Content",
  "E-commerce",
  "Retail",
  "Finance",
  "Business",
  "Design",
  "Creative",
  "Health",
  "Wellness",
  "Gaming",
  "Architecture",
  "Music",
  "Film",
  "Food & Beverage",
  "Real Estate",
  "Non-profit",
  "Government",
  "Other",
  "It changes often",
] as const;

export const FOCUS_GOAL_OPTIONS: ReadonlyArray<{ label: string; hours: number | null }> = [
  ...Array.from({ length: 24 }, (_, i) => ({ label: `${i + 1} hour${i === 0 ? "" : "s"}`, hours: i + 1 })),
  { label: "Not sure yet", hours: null },
];

export const DRIFT_REMINDER_OPTIONS: ReadonlyArray<{ label: string; minutes: number | null }> = [
  { label: "Instantly", minutes: 0 },
  { label: "After 5 minutes", minutes: 5 },
  { label: "After 10 minutes", minutes: 10 },
  { label: "After 15 minutes", minutes: 15 },
  { label: "After 30 minutes", minutes: 30 },
  { label: "Off for now", minutes: null },
];

export type WorkType = (typeof WORK_TYPE_OPTIONS)[number];
export type MainActivity = (typeof MAIN_ACTIVITY_OPTIONS)[number];
export type WorkDomain = (typeof WORK_DOMAIN_OPTIONS)[number];
