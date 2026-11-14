import { mitgliedEinladen, mitgliedEntfernen, mitgliedSpeichern } from "@/app/actions";
import { Shell, feld, karte, knopf } from "@/components/Shell";
import { getOrgContext } from "@/lib/org";

const OK: Record<string, string> = {
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
const entfernenKnopf = "rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700";

export default function TeamPage({ searchParams }: PageProps<"/team">) {
  return (
    <Shell title="Team" intro="Wer Lotse nutzt und mit welcher Rolle. Die Rolle bestimmt, welche Funktionen Lotse einer Person zeigt.">
      <Inhalt searchParams={searchParams} />
    </Shell>
  );
}

async function Inhalt({ searchParams }: { searchParams: PageProps<"/team">["searchParams"] }) {
  const { supabase, isAdmin, userId } = await getOrgContext();
  const { data: members } = await supabase.from("org_members").select("user_id, email, role, is_admin").order("email");
  const { ok, fehler } = await searchParams;
  const okText = typeof ok === "string" ? OK[ok] : undefined;
  const fehlerText = typeof fehler === "string" ? FEHLER[fehler] : undefined;

  return (
    <>
      {okText && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800 dark:bg-green-950 dark:text-green-300">{okText}</p>}
      {fehlerText && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{fehlerText}</p>}
      <div className={karte}>
        <table className="w-full text-left text-sm">
          <thead className="text-zinc-500">
            <tr>
              <th className="py-1 pr-3 font-normal">Person</th>
              <th className="py-1 pr-3 font-normal">Rolle</th>
              <th className="py-1 pr-3 font-normal">Admin</th>
              {isAdmin && <th />}
            </tr>
          </thead>
          <tbody>
            {(members ?? []).map((m) =>
              isAdmin ? (
                <tr key={m.user_id} className="border-t border-zinc-100 dark:border-zinc-900">
                  <td className="py-2 pr-3">
                    {m.email ?? m.user_id}
                    {m.user_id === userId && <span className="text-zinc-500"> (du)</span>}
                  </td>
                  <td className="py-2 pr-3">
                    <input form={`m-${m.user_id}`} name="role" defaultValue={m.role} className={feld} />
                  </td>
                  <td className="py-2 pr-3">
                    <input form={`m-${m.user_id}`} name="isAdmin" type="checkbox" defaultChecked={m.is_admin} className="size-4" />
                  </td>
                  <td className="py-2">
                    <div className="flex gap-2">
                      <form id={`m-${m.user_id}`} action={mitgliedSpeichern}>
                        <input type="hidden" name="userId" value={m.user_id} />
                        <button className={knopf}>Speichern</button>
                      </form>
                      {m.user_id !== userId && (
                        <form action={mitgliedEntfernen}>
                          <input type="hidden" name="userId" value={m.user_id} />
                          <button className={entfernenKnopf}>Entfernen</button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={m.user_id} className="border-t border-zinc-100 dark:border-zinc-900">
                  <td className="py-2 pr-3">{m.email ?? m.user_id}</td>
                  <td className="py-2 pr-3">{m.role}</td>
                  <td className="py-2 pr-3">{m.is_admin ? "ja" : "nein"}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      {isAdmin && (
        <div className={karte}>
          <h2 className="font-medium">Person einladen</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Legt ein Konto mit Startpasswort an. Gib E-Mail und Passwort selbst an die Person weiter.
          </p>
          <form action={mitgliedEinladen} className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              E-Mail
              <input name="email" type="email" required className={feld} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Rolle
              <input name="role" required defaultValue="Mitarbeiter" className={feld} placeholder="z. B. Büro, Monteur" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Startpasswort (mindestens 8 Zeichen)
              <input name="password" required minLength={8} defaultValue={crypto.randomUUID().slice(0, 12)} autoComplete="off" className={feld} />
            </label>
            <label className="flex items-center gap-2 self-end py-2 text-sm">
              <input name="isAdmin" type="checkbox" className="size-4" />
              Admin (darf die Organisation verwalten)
            </label>
            <div className="sm:col-span-2">
              <button className={knopf}>Einladen</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
