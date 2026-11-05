import { Banner } from "../../../../components/ui/banner";

export default function LoadingLiveData() {
  return (
    <Banner role="status" aria-live="polite" title="Loading market-data readiness">
      <p>Checking provider configuration, catalogue freshness and tracked instruments.</p>
    </Banner>
  );
}
