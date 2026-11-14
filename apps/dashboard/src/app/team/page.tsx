import { mitgliedEinladen, mitgliedEntfernen, mitgliedSpeichern } from "@/app/actions";
import { Shell } from "@/components/Shell";
import { Button, Checkbox, DangerButton, Field, FormActions, Notice, PRODUCT_NAME, Table, Td, Th } from "@/components/ui";
import { getOrgContext } from "@/lib/org";

const OK: Record<string, string> = {
  gespeichert: "Gespeichert.",
  eingeladen: "Konto angelegt und zur Organisation hinzugefügt. Gib der Person E-Mail und Startpasswort weiter.",
  hinzugefuegt: "Das Konto gab es schon. Es ist jetzt in deiner Organisation (das bisherige Passwort gilt weiter).",
  entfernt: "Person aus der Organisation entfernt. Ihr Konto bleibt bestehen.",
};
const FEHLER: Record<string, string> = {
  email: "Bitte gib eine gültige E-Mail ein.",
  rolle: "Bitte gib eine Rolle ein.",
  passwort: "Das Startpasswort braucht mindestens 8 Zeichen.",
  konto: "Das Konto konnte nicht angelegt werden.",
  "schon-dabei": "Diese Person ist schon in deiner Organisation.",
  selbst: "Du kannst dich nicht selbst entfernen.",
  speichern: "Speichern hat nicht geklappt. Bitte versuch es noch einmal.",
};

export default function TeamPage({ searchParams }: PageProps<"/team">) {
  return (
    <Shell href="/team" title="Team" intro={`Wer ${PRODUCT_NAME} nutzt und wer Admin ist. Die Rolle steuert, welche Hinweise jemand bekommt.`}>
      <Inhalt searchParams={searchParams} />
    </Shell>
  );
}

async function Inhalt({ searchParams }: { searchParams: PageProps<"/team">["searchParams"] }) {
  const [{ supabase, isAdmin, userId }, { ok, fehler }] = await Promise.all([getOrgContext(), searchParams]);
  const { data: members } = await supabase.from("org_members").select("user_id, email, role, is_admin").order("email");
  const okText = typeof ok === "string" ? OK[ok] : undefined;
  const fehlerText = typeof fehler === "string" ? FEHLER[fehler] : undefined;

  return (
    <>
      {okText && <Notice tone="success" title={okText} />}
      {fehlerText && <Notice tone="error" title={fehlerText} />}
      <div className="grid gap-2.5">
        <Table>
          <thead>
            <tr>
              <Th>E-Mail</Th>
              <Th className="w-[260px]">Rolle</Th>
              <Th className="w-[90px]">Admin</Th>
              {isAdmin && <Th className="w-[240px] text-right">Aktionen</Th>}
            </tr>
          </thead>
          <tbody>
            {(members ?? []).map((m) => {
              const me = m.user_id === userId;
              const fid = `m-${m.user_id}`; // <form> must not wrap <tr> → fields join it via the form attribute
              const email = m.email ?? m.user_id;
              return isAdmin ? (
                <tr key={m.user_id} className="hover:bg-surface-hover">
                  <Td className="py-2 align-middle">{email} {me && <span className="text-muted">(du)</span>}</Td>
                  <Td className="py-2 align-middle"><input form={fid} name="role" defaultValue={m.role} aria-label={`Rolle von ${email}`} className="h-10 w-full rounded-md border border-line-strong bg-input px-2.5 text-base text-text" /></Td>
                  <Td className="py-2 align-middle"><label className="inline-flex size-10 cursor-pointer items-center justify-center"><Checkbox form={fid} name="isAdmin" defaultChecked={m.is_admin} aria-label={`${email} ist Admin`} /></label></Td>
                  <Td className="py-2 align-middle">
                    <div className="flex justify-end gap-2">
                      <form id={fid} action={mitgliedSpeichern}><input type="hidden" name="userId" value={m.user_id} /><Button type="submit" variant="secondary" size="sm">Speichern</Button></form>
                      {!me && <form action={mitgliedEntfernen}><input type="hidden" name="userId" value={m.user_id} /><DangerButton type="submit" aria-label={`${email} entfernen`}>Entfernen</DangerButton></form>}
                    </div>
                  </Td>
                </tr>
              ) : (
                <tr key={m.user_id} className="hover:bg-surface-hover">
                  <Td>{email} {me && <span className="text-muted">(du)</span>}</Td>
                  <Td>{m.role}</Td>
                  <Td>{m.is_admin ? "ja" : "nein"}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        <span className="px-4 text-sm text-muted">{members?.length ?? 0} Personen</span>
      </div>

      {isAdmin && (
        <form id="einladen" action={mitgliedEinladen} className="grid gap-4 rounded-lg border border-line bg-surface p-6">
          <div>
            <h2 className="m-0 text-xl font-semibold">Person einladen</h2>
            <p className="mt-1 mb-0 text-muted">Legt ein Konto mit Startpasswort an. Die Person ändert das Startpasswort bei der ersten Anmeldung.</p>
          </div>
          <div className="grid grid-cols-[1.4fr_1fr_1fr_auto] items-end gap-4">
            <Field label="E-Mail" name="email" type="email" required placeholder="name@demo.test" />
            <Field label="Rolle" name="role" required placeholder="z. B. Monteur" />
            <Field label="Startpasswort" name="password" minLength={8} required autoComplete="off" defaultValue={crypto.randomUUID().slice(0, 12)} mono />
            <label className="flex h-11 cursor-pointer items-center gap-2.5 font-semibold"><Checkbox name="isAdmin" />Admin</label>
          </div>
          <FormActions submitLabel="Einladen" />
        </form>
      )}
    </>
  );
}
