import { ReportView } from "@/components/report/ReportView";

/**
 * A submitted report's own view (its Daily Report, with Share, Delete, Edit Report and Close):
 * `/entity/<shortid>/<name>/petty-cash/reports/<report id>/summary` - Flask's address for the same
 * page, so a link into one works in the other. `?edit=details` (report history's Edit Details)
 * opens it in Edit Details.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ reportId: string }>;
  searchParams: Promise<{ edit?: string | string[] }>;
}) {
  const { reportId } = await params;
  const { edit } = await searchParams;
  return <ReportView reportId={reportId} editDetails={edit === "details"} />;
}
