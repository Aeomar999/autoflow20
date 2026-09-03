import { InvitationsList } from "@/features/organizations/components/invitations-list";
import { MembersList } from "@/features/organizations/components/members-list";

const Page = () => (
  <div className="flex flex-col gap-4">
    <MembersList />
    <InvitationsList />
  </div>
);

export default Page;
