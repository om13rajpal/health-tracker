import Link from "next/link";
import { PageHeader } from "../components/ui";

export default function NotFound() {
  return (
    <>
      <PageHeader
        title="No such page"
        blurb="Nothing is recorded at this address. Everything in the ledger is reachable from Today."
      />
      <main className="measure py-8">
        <Link href="/" className="btn btn-primary">
          Back to Today
        </Link>
      </main>
    </>
  );
}
