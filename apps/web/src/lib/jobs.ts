export const applicationStatuses = [
  ["interested", "Interested"],
  ["planning_to_apply", "Planning to Apply"],
  ["applied", "Applied"],
  ["referral_requested", "Referral Requested"],
  ["interviewing", "Interviewing"],
  ["offer", "Offer"],
  ["rejected", "Rejected"],
] as const;

export type ApplicationStatus = (typeof applicationStatuses)[number][0];

export interface SavedJob {
  id: string;
  title: string | null;
  company: string | null;
  location: string | null;
  description: string | null;
  application: { status: ApplicationStatus } | null;
}

export function isSavedJob(value: unknown): value is SavedJob {
  if (typeof value !== "object" || value === null) return false;
  const job = value as Record<string, unknown>;
  const application = job.application;
  return (
    typeof job.id === "string" &&
    ["title", "company", "location", "description"].every(
      (field) => job[field] === null || typeof job[field] === "string",
    ) &&
    (application === null ||
      (typeof application === "object" &&
        application !== null &&
        "status" in application &&
        applicationStatuses.some(([status]) => status === application.status)))
  );
}

export function statusLabel(status: ApplicationStatus) {
  return applicationStatuses.find(([value]) => value === status)?.[1];
}

export interface JobDetail extends SavedJob {
  requisition_id: string | null;
  technologies: string[] | null;
  experience_requirements: string | null;
  seniority: string | null;
  department: string | null;
  source_url: string | null;
  created_at: string;
  updated_at: string;
  application: {
    id: string;
    job_id: string;
    status: ApplicationStatus;
    created_at: string;
    updated_at: string;
  } | null;
}

export function isJobId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function isJobDetail(value: unknown): value is JobDetail {
  if (!isSavedJob(value)) return false;
  const job = value as SavedJob & Record<string, unknown>;
  const application = job.application;
  return (
    isJobId(job.id) &&
    [
      "requisition_id",
      "experience_requirements",
      "seniority",
      "department",
      "source_url",
    ].every((field) => job[field] === null || typeof job[field] === "string") &&
    (job.technologies === null ||
      (Array.isArray(job.technologies) &&
        job.technologies.every((item) => typeof item === "string"))) &&
    isTimestamp(job.created_at) &&
    isTimestamp(job.updated_at) &&
    (application === null ||
      ("id" in application &&
        typeof application.id === "string" &&
        isJobId(application.id) &&
        "job_id" in application &&
        application.job_id === job.id &&
        "created_at" in application &&
        isTimestamp(application.created_at) &&
        "updated_at" in application &&
        isTimestamp(application.updated_at)))
  );
}

export function safeSourceUrl(value: string | null): string | null {
  if (value === null) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
