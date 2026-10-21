export const draftFields = [
  ["title", "Title"],
  ["company", "Company"],
  ["requisition_id", "Requisition ID"],
  ["location", "Location"],
  ["seniority", "Seniority"],
  ["department", "Department"],
] as const;

export interface JobDraft {
  title: string | null;
  company: string | null;
  requisition_id: string | null;
  location: string | null;
  seniority: string | null;
  department: string | null;
  description: string;
  technologies: string[] | null;
  experience_requirements: string | null;
  source_url: string | null;
  warnings: string[];
}

export function isJobDraft(value: unknown): value is JobDraft {
  if (typeof value !== "object" || value === null) return false;
  const draft = value as Record<string, unknown>;
  return (
    typeof draft.description === "string" &&
    draft.description.trim().length > 0 &&
    [
      ...draftFields.map(([field]) => field),
      "experience_requirements",
      "source_url",
    ].every(
      (field) => draft[field] === null || typeof draft[field] === "string",
    ) &&
    (draft.technologies === null ||
      (Array.isArray(draft.technologies) &&
        draft.technologies.every((item) => typeof item === "string"))) &&
    Array.isArray(draft.warnings) &&
    draft.warnings.every((item) => typeof item === "string")
  );
}
