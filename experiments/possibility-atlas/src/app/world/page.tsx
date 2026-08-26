import { FixtureModeBanner } from "../../components/fixture-banner";
import { WorldView } from "../../components/world-view";

export default function WorldPage() {
  const fixtureMode =
    process.env.NODE_ENV !== "production" &&
    process.env.POSSIBILITY_ATLAS_FIXTURE_MODE === "1";

  return (
    <>
      {fixtureMode ? <FixtureModeBanner /> : null}
      <WorldView />
    </>
  );
}
