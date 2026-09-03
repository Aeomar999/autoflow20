import { redirect } from "next/navigation";

/**
 * `/settings` has no content of its own — the sidebar links here so the whole
 * area highlights as active, and Profile is the first tab. Redirect straight to
 * it rather than render an empty shell.
 */
const Page = () => {
  redirect("/settings/profile");
};

export default Page;
