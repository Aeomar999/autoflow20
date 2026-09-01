import { ResetPasswordForm } from "@/features/auth/components/reset-password-form";
import { requireUnauth } from "@/lib/auth-utils";

type SearchParams = {
  token?: string;
};

type Props = {
  searchParams: Promise<SearchParams>;
};

const Page = async ({ searchParams }: Props) => {
  await requireUnauth();

  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";

  return <ResetPasswordForm token={token} />;
};

export default Page;
