import type { Metadata } from "next";
import { SkyClimberGame } from "./components/SkyClimberGame";

export const metadata: Metadata = {
  title: "Taipei 101: Sky Climber",
  description: "A hand-over-hand 3D arcade climb to the top of Taipei 101.",
};

export default function Home() {
  return <SkyClimberGame />;
}
