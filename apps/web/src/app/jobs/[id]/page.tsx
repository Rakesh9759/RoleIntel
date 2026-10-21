import { Suspense } from "react";
import { JobDetails } from "@/components/job-details";

async function Details({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <JobDetails key={id} id={id} />;
}

export default function JobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<p role="status">Loading job...</p>}>
      <Details params={params} />
    </Suspense>
  );
}
