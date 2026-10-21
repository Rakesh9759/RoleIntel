import { forwardJobRequest } from "@/lib/job-proxy";

export function POST(request: Request) {
  return forwardJobRequest(request, "/api/jobs/parse");
}
