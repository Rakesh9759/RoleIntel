import { forwardJobRequest } from "@/lib/job-proxy";

export async function POST(request: Request) {
  return forwardJobRequest(request, "/api/jobs/import/lever");
}
