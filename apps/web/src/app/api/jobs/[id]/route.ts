import { forwardJobRequest } from "@/lib/job-proxy";
import { isJobId } from "@/lib/jobs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isJobId(id))
    return Response.json({ message: "Invalid job ID." }, { status: 422 });
  return forwardJobRequest(request, `/api/jobs/${id}`);
}
