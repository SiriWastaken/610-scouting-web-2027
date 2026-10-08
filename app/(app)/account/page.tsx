import type { Metadata } from "next";
import { AccountPanel } from "@/components/auth/account-panel";
import { requirePage } from "@/lib/auth/pages";
import { PageHeader } from "@/components/ui/kit";
import { appConfig } from "@/app.config";

export const metadata: Metadata = { title: `Account · ${appConfig.team.productName}` };

export default async function AccountPage() {
  await requirePage();
  return <div className="mx-auto max-w-[900px]">
    <PageHeader title="Your account" description={<>How you appear to the team, your access, and where you&apos;re signed in.</>} />
    <AccountPanel />
  </div>;
}
