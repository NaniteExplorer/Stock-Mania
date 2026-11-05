"use client";

import { Button } from "../../../components/ui/button";
import { InsuranceReadError } from "./insurance-screen";

/** Unexpected failures; expected read failures are named by the page itself. */
export default function InsuranceError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <InsuranceReadError failed="The insurance screen" retry={<Button type="button" variant="outline" onClick={() => retry()}>Retry</Button>} />;
}
