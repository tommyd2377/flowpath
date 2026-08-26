import { HeadlinePicker } from "../components/headline-picker";
import { FixtureModeBanner } from "../components/fixture-banner";

export default function Home() {
  const fixtureMode =
    process.env.NODE_ENV !== "production" &&
    process.env.POSSIBILITY_ATLAS_FIXTURE_MODE === "1";

  return (
    <>
      {fixtureMode ? <FixtureModeBanner /> : null}
      <HeadlinePicker />
    </>
  );
}
