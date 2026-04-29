import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default async function HomePage() {
  const session = (await cookies()).get("jb_session");
  if (session?.value) {
    redirect("/statistics");
  }
  redirect("/login");
}
