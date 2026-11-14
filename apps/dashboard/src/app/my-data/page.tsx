import { LOTSE_DEFAULTS, MY_DATA_TABLES, MyDataSchema, type MyData, type MyDataTable } from "@lotse/shared";
import { Shell, type NavHref } from "@/components/Shell";
import { Card, Checkbox, Footnote, Notice, PRODUCT_NAME, Table, Td, Th, DangerButton } from "@/components/ui";
import { getOrgContext } from "@/lib/org";
import { meineDatenLoeschen } from "./actions";

const LABEL: Record<MyDataTable, string> = {
  agent_usage: "AI requests",
  lotse_events: "Interaction events (pseudonymized)",
  lotse_user_prefs: "Personal help threshold",
  lotse_offers: "Help offers shown",
  lotse_offer_feedback: "Your feedback on offers",
  agent_memory_evidence: "Contributions to shared agent memory (hashed)",
  knowledge_gap_subjects: "Unanswered-question signals (hashed)",
};
const FEHLER: Record<string, string> = {
  confirm: "Please tick the box to confirm the deletion.",
  delete: "Deleting didn't work. Nothing or only part may have been deleted, please try again.",
  "rate-limited": "Too many requests in a short time. Please wait a minute and try again.",
};

export default function MyDataPage({ searchParams }: PageProps<"/my-data">) {
  return (
    // ponytail: cast until "/my-data" is in Shell's NAV (owned by another session)
    <Shell href={"/my-data" as NavHref} title={`What ${PRODUCT_NAME} stores about me`} intro={`Everything ${PRODUCT_NAME} keeps about you personally, as counts. You can delete it at any time.`}>
      <Inhalt searchParams={searchParams} />
    </Shell>
  );
}

async function laden(token: string | undefined): Promise<MyData | "rate-limited" | null> {
  try {
    const res = await fetch(`${process.env.LOTSE_SERVER_URL ?? LOTSE_DEFAULTS.serverUrl}/api/lotse/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (res.status === 429) return "rate-limited";
    return res.ok ? (MyDataSchema.safeParse(await res.json()).data ?? null) : null;
  } catch {
    return null;
  }
}

async function Inhalt({ searchParams }: { searchParams: PageProps<"/my-data">["searchParams"] }) {
  const [ctx, { ok, n, error }] = await Promise.all([getOrgContext(), searchParams]);
  const result = await laden((await ctx.supabase.auth.getSession()).data.session?.access_token);
  const data = result === "rate-limited" ? null : result;
  const fehlerText = typeof error === "string" ? FEHLER[error] : undefined;
  const total = data ? MY_DATA_TABLES.reduce((s, t) => s + data.counts[t], 0) : 0;

  return (
    <>
      {ok === "deleted" && <Notice tone="success" title={`Your ${PRODUCT_NAME} data was deleted (${Number(n) || 0} entries).`} />}
      {fehlerText && <Notice tone="error" title={fehlerText} />}

      {data ? (
        <div className="grid gap-2.5">
          <Table>
            <thead>
              <tr><Th>What</Th><Th className="w-[140px] text-right">Entries</Th></tr>
            </thead>
            <tbody>
              {MY_DATA_TABLES.map((t) => (
                <tr key={t} className="hover:bg-surface-hover">
                  <Td>{LABEL[t]}</Td>
                  <Td className="text-right tabular-nums">{data.counts[t]}</Td>
                </tr>
              ))}
              <tr>
                <Td>Your help threshold</Td>
                <Td className="text-right tabular-nums">{data.proactiveThreshold == null ? "default" : `${Math.round(data.proactiveThreshold * 100)}%`}</Td>
              </tr>
            </tbody>
          </Table>
          <span className="px-4 text-sm text-muted">{total} entries in total</span>
        </div>
      ) : (
        <Notice tone="error" title={`Couldn't load your data from the ${PRODUCT_NAME} server.`}>
          <p className="m-0">{result === "rate-limited" ? "Too many requests in a short time. Please wait a minute and reload." : "The server may be unreachable right now. Please try again later."}</p>
        </Notice>
      )}

      <Notice tone="privacy" title="What this means">
        <ul className="m-0 grid gap-1 pl-5">
          <li>No page contents are stored: names, customers and other personal data are replaced by placeholders like [Kunde-1] or [Person-2] in your browser before anything is sent.</li>
          <li>Data from before you signed in to the extension can&apos;t be linked to you, so it can&apos;t be shown or deleted here.</li>
          <li>Admins never see your personal help threshold.</li>
        </ul>
      </Notice>

      <Card className="grid gap-4">
        <div>
          <h2 className="m-0 text-xl font-semibold">Delete all my {PRODUCT_NAME} data</h2>
          <p className="mt-1 mb-0 text-muted">Removes every entry listed above. Shared, anonymous patterns stay, they just no longer count you.</p>
        </div>
        <form action={meineDatenLoeschen} className="flex flex-wrap items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2.5 font-semibold">
            <Checkbox name="confirm" value="yes" required />I understand this cannot be undone
          </label>
          <DangerButton type="submit">Delete all my data</DangerButton>
        </form>
      </Card>
      <Footnote>Only you can see this page&apos;s numbers. Your account itself is not deleted.</Footnote>
    </>
  );
}
