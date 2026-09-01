import { VerifyEmailCard } from "@/features/auth/components/verify-email-card";
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
  const token = typeof params.token === "string" ? params.token : undefined;

  return <VerifyEmailCard token={token} />;
};

export default Page;
