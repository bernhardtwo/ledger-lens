import { AccountWorkspace } from "../../../components/AccountWorkspace";

// Next 15: `params` is async.
export default async function AccountPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
  return <AccountWorkspace accountId={accountId} />;
}
