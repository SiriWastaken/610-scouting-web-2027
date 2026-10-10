// / — sends signed-in users to the Teams page.
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/teams");
}
