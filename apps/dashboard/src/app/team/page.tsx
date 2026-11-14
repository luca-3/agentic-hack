import { mitgliedSpeichern } from "@/app/actions";
import { Shell, feld, karte, knopf } from "@/components/Shell";
import { getOrgContext } from "@/lib/org";

export default function TeamPage() {
  return (
    <Shell title="Team" intro="Wer Lotse nutzt und mit welcher Rolle. Die Rolle bestimmt, welche Funktionen Lotse einer Person zeigt.">
      <Inhalt />
    </Shell>
  );
}

async function Inhalt() {
  const { supabase, isAdmin, userId } = await getOrgContext();
  const { data: members } = await supabase.from("org_members").select("user_id, email, role, is_admin").order("email");

  return (
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
                  <form id={`m-${m.user_id}`} action={mitgliedSpeichern}>
                    <input type="hidden" name="userId" value={m.user_id} />
                    <button className={knopf}>Speichern</button>
                  </form>
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
      <p className="mt-4 text-xs text-zinc-500">Einladen kommt später (heute: Testkonten aus supabase/seeds/dashboard.sql).</p>
    </div>
  );
}
