import { DashboardPage } from "@/components/dashboard/page";
import { CredentialForm } from "@/features/credentials/components/credential";
import { requireAuth } from "@/lib/auth-utils";

const Page = async () => {
  await requireAuth();

  return (
    <DashboardPage>
      <CredentialForm />
    </DashboardPage>
  );
};

export default Page;
