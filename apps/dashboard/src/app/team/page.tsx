import { mitgliedEinladen, mitgliedEntfernen, mitgliedSpeichern } from "@/app/actions";
import { Shell } from "@/components/Shell";
import { Button, Checkbox, DangerButton, Field, FormActions, Notice, PRODUCT_NAME, Table, Td, Th } from "@/components/ui";
import { getOrgContext } from "@/lib/org";

const OK: Record<string, string> = {
  saved: "Saved.",
  invited: "Account created and added to the organization. Share the email and start password with the person.",
  added: "This account already existed. It's now part of your organization (the existing password still applies).",
  removed: "Person removed from the organization. Their account remains.",
  "removed-data": "Person removed from the organization and their Valo data deleted. Their account remains.",
};
const FEHLER: Record<string, string> = {
  email: "Please enter a valid email address.",
  role: "Please enter a role.",
  password: "The start password needs at least 8 characters.",
  account: "The account could not be created.",
  "already-member": "This person is already in your organization.",
  self: "You can't remove yourself.",
  save: "Saving didn't work. Please try again.",
  "self-admin": "You can't remove your own admin rights.",
  "last-admin": "An organization needs at least one admin.",
  data: "Deleting their Valo data failed (part of it may already be deleted). The person was not removed. Please try again.",
  "data-shared": "This person also belongs to another organization, so their Valo data can't be deleted from here. Untick the box to only remove them.",
  "removed-after-data": "Their Valo data was deleted, but removing the person from the organization failed. Please click Remove again.",
  "rate-limited": "Too many data requests in a short time. Please wait a minute and try again.",
};

export default function TeamPage({ searchParams }: PageProps<"/team">) {
  return (
    <Shell href="/team" title="Team" intro={`Who uses ${PRODUCT_NAME} and who is an admin. The role decides which hints someone gets.`}>
      <Inhalt searchParams={searchParams} />
    </Shell>
  );
}

async function Inhalt({ searchParams }: { searchParams: PageProps<"/team">["searchParams"] }) {
  const [{ supabase, isAdmin, userId }, { ok, error, data }] = await Promise.all([getOrgContext(), searchParams]);
  const { data: members } = await supabase.from("org_members").select("user_id, email, role, is_admin").order("email");
  const okText = typeof ok === "string" ? (ok === "removed" && data === "1" ? OK["removed-data"] : OK[ok]) : undefined;
  const fehlerText = typeof error === "string" ? FEHLER[error] : undefined;

  return (
    <>
      {okText && <Notice tone="success" title={okText} />}
      {fehlerText && <Notice tone="error" title={fehlerText} />}
      <div className="grid gap-2.5">
        <Table>
          <thead>
            <tr>
              <Th>Email</Th>
              <Th className="w-[260px]">Role</Th>
              <Th className="w-[90px]">Admin</Th>
              {isAdmin && <Th className="w-[240px] text-right">Actions</Th>}
            </tr>
          </thead>
          <tbody>
            {(members ?? []).map((m) => {
              const me = m.user_id === userId;
              const fid = `m-${m.user_id}`; // <form> must not wrap <tr> → fields join it via the form attribute
              const email = m.email ?? m.user_id;
              return isAdmin ? (
                <tr key={m.user_id} className="hover:bg-surface-hover">
                  <Td className="py-2 align-middle">{email} {me && <span className="text-muted">(you)</span>}</Td>
                  <Td className="py-2 align-middle"><input form={fid} name="role" defaultValue={m.role} aria-label={`Role of ${email}`} className="h-10 w-full rounded-md border border-line-strong bg-input px-2.5 text-base text-text" /></Td>
                  <Td className="py-2 align-middle"><label className="inline-flex size-10 cursor-pointer items-center justify-center"><Checkbox form={fid} name="isAdmin" defaultChecked={m.is_admin} aria-label={`${email} is admin`} /></label></Td>
                  <Td className="py-2 align-middle">
                    <div className="flex justify-end gap-2">
                      <form id={fid} action={mitgliedSpeichern}><input type="hidden" name="userId" value={m.user_id} /><Button type="submit" variant="secondary" size="sm">Save</Button></form>
                      {!me && (
                        <form action={mitgliedEntfernen} className="flex items-center gap-2">
                          <input type="hidden" name="userId" value={m.user_id} />
                          <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-muted" title="Also delete this person's Valo data">
                            <Checkbox name="deleteData" defaultChecked aria-label={`Also delete ${email}'s Valo data`} />
                            Also delete this person&apos;s Valo data
                          </label>
                          <DangerButton type="submit" aria-label={`Remove ${email}`}>Remove</DangerButton>
                        </form>
                      )}
                    </div>
                  </Td>
                </tr>
              ) : (
                <tr key={m.user_id} className="hover:bg-surface-hover">
                  <Td>{email} {me && <span className="text-muted">(you)</span>}</Td>
                  <Td>{m.role}</Td>
                  <Td>{m.is_admin ? "yes" : "no"}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        <span className="px-4 text-sm text-muted">{members?.length ?? 0} people</span>
      </div>

      {isAdmin && (
        <form id="invite" action={mitgliedEinladen} className="grid gap-4 rounded-lg border border-line bg-surface p-6">
          <div>
            <h2 className="m-0 text-xl font-semibold">Invite someone</h2>
            <p className="mt-1 mb-0 text-muted">Creates an account with a start password. The person changes it at their first sign-in.</p>
          </div>
          <div className="grid grid-cols-[1.4fr_1fr_1fr_auto] items-end gap-4">
            <Field label="Email" name="email" type="email" required placeholder="name@demo.test" />
            <Field label="Role" name="role" required placeholder="e.g. Technician" />
            <Field label="Start password" name="password" minLength={8} required autoComplete="off" defaultValue={crypto.randomUUID().slice(0, 12)} mono />
            <label className="flex h-11 cursor-pointer items-center gap-2.5 font-semibold"><Checkbox name="isAdmin" />Admin</label>
          </div>
          <FormActions submitLabel="Invite" />
        </form>
      )}
    </>
  );
}
