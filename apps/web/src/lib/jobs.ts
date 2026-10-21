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
