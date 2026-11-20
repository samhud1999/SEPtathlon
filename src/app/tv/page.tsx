import TvDashboard from "./TvDashboard";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "THE SEPTATHLON",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function TvPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const endpoint = params.mock ? "/api/mock-state" : "/api/state";
  return <TvDashboard endpoint={endpoint} />;
}
