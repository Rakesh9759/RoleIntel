import { forwardJobRequest } from "@/lib/job-proxy";

export function GET(request: Request) {
  return forwardJobRequest(request);
}

export function POST(request: Request) {
  return forwardJobRequest(request);
}
