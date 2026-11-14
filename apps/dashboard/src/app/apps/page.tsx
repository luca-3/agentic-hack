import { appAnlegen, domainsSpeichern, funktionenImportieren } from "@/app/actions";
import { Shell } from "@/components/Shell";
import { Card, EmptyState, Field, FormActions, IconChevron, Notice, PRODUCT_NAME, Table, Td, TextareaField, Th } from "@/components/ui";
import { getOrgContext } from "@/lib/org";

export default function AppsPage({ searchParams }: PageProps<"/apps">) {
  return (
    <Shell href="/apps" title="Apps & features" intro={`Which apps ${PRODUCT_NAME} knows and where their features live.`}>
      <Inhalt searchParams={searchParams} />
    </Shell>
  );
}

const FEHLER: Record<string, string> = {
  json: "The JSON is not valid. Nothing was changed.",
  format: "The JSON doesn't match the format: a list with name, description, route, clickPath (list), requiredRole (list, optional). Nothing was changed.",
};

type Feature = { id: number; name: string; route: string; click_path: string[]; description: string | null; required_roles: string[] | null };

async function Inhalt({ searchParams }: { searchParams: PageProps<"/apps">["searchParams"] }) {
  const [{ supabase, isAdmin }, sp] = await Promise.all([getOrgContext(), searchParams]);
  const { data: apps } = await supabase
    .from("apps")
    .select("id, name, domains, app_features(id, name, route, click_path, description, required_roles)")
    .order("name");
  const ok = typeof sp.ok === "string" ? sp.ok : undefined;
  const okText = ok === "created" ? "App created." : ok === "saved" ? "Saved." : ok ? `${ok} features imported.` : undefined;

  return (
    <>
      {okText && <Notice tone="success" title={okText} />}
      {typeof sp.error === "string" && FEHLER[sp.error] && <Notice tone="error" title={FEHLER[sp.error]} />}
      {!apps?.length && <EmptyState title="No apps yet" text="Create your first app below under “New app”." />}

      {(apps ?? []).map((app) => {
        const features = ((app.app_features ?? []) as Feature[]).sort((a, b) => a.id - b.id);
        return (
          <Card key={app.id} className="grid gap-5">
            <div className="flex items-center gap-3">
              <h2 className="m-0 text-[22px] font-semibold">{app.name}</h2>
              <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-sm font-medium">{features.length} {features.length === 1 ? "feature" : "features"}</span>
            </div>
            {isAdmin ? (
              <form action={domainsSpeichern} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="appId" value={app.id} />
                <Field className="min-w-80 flex-1" label="Domains (comma-separated)" name="domains" id={`domains-${app.id}`} defaultValue={app.domains.join(", ")} mono />
                <FormActions submitLabel="Save" />
              </form>
            ) : (
              <p className="m-0 text-muted">Domains: <span className="font-mono text-text">{app.domains.join(", ") || "–"}</span></p>
            )}
            {features.length > 0 && (
              <details open className="rounded-[10px] border border-line p-4">
                <summary className="cursor-pointer font-semibold">Navigation tree <span className="text-sm font-normal text-muted">– all click paths merged</span></summary>
                <ul className="mt-3 space-y-1 text-sm">{pathTree(features).map((n) => <TreeNode key={n.label} node={n} />)}</ul>
              </details>
            )}
            <Table>
              <thead><tr><Th className="w-[40%] bg-surface-2">Feature</Th><Th className="bg-surface-2">Click path</Th><Th className="w-40 bg-surface-2">Roles</Th></tr></thead>
              <tbody>
                {features.length === 0 && <tr><Td colSpan={3} className="text-center text-muted">No features yet.</Td></tr>}
                {features.map((f) => (
                  <tr key={f.id} className="hover:bg-surface-hover">
                    <Td>
                      <div className="font-semibold">{f.name}</div>
                      {f.description && <div className="text-sm text-muted">{f.description}</div>}
                      <code className="mt-1 inline-block rounded-[4px] bg-surface-2 px-1.5 py-px font-mono text-xs">{f.route}</code>
                    </Td>
                    <Td>
                      <ol className="m-0 flex list-none flex-wrap items-center gap-1 p-0 text-sm">
                        {f.click_path.map((step, i) => (
                          <li key={i} className="flex items-center gap-1">
                            {i > 0 && <span aria-hidden className="text-muted">›</span>}
                            <span className={`rounded-md px-2 py-0.5 ${i === f.click_path.length - 1 ? "bg-[#FF8A3D]/15 font-medium" : "bg-surface-2"}`}>{step}</span>
                          </li>
                        ))}
                      </ol>
                    </Td>
                    <Td><Roles roles={f.required_roles} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {isAdmin && (
              <details className="rounded-[10px] border border-line" open={sp.app === app.id && typeof sp.error === "string"}>
                <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3.5 font-semibold"><span data-chev><IconChevron /></span>Replace feature list with JSON</summary>
                <form action={funktionenImportieren} className="grid gap-2.5 px-3.5 pt-1 pb-4">
                  <input type="hidden" name="appId" value={app.id} />
                  <p className="m-0 text-sm text-muted">Replaces all features of this app. Fields: name, description, route, clickPath, requiredRole.</p>
                  <TextareaField label="Feature list (JSON)" name="json" mono required spellCheck={false} rows={12} defaultValue={JSON.stringify(features.map(alsJson), null, 2)} />
                  <FormActions submitLabel="Apply" />
                </form>
              </details>
            )}
          </Card>
        );
      })}

      {isAdmin && (
        <form id="new-app" action={appAnlegen} className="grid gap-4 rounded-lg border border-line bg-surface p-6">
          <h2 className="m-0 text-xl font-semibold">New app</h2>
          <div className="grid grid-cols-[1fr_2fr] gap-4">
            <Field label="Name" name="name" id="new-name" required placeholder="e.g. Customer portal" />
            <Field label="Domains (comma-separated)" name="domains" id="new-domains" placeholder="localhost:3200, app.example.test" mono />
          </div>
          <FormActions submitLabel="Create" />
        </form>
      )}
    </>
  );
}

const alsJson = (f: Feature) => ({
  name: f.name,
  description: f.description ?? "",
  route: f.route,
  clickPath: f.click_path,
  requiredRole: f.required_roles,
});

/* ── Navigation tree: all click paths of an app merged into one prefix tree ───────────────────────── */

type TreeNodeData = { label: string; children: TreeNodeData[]; features: Feature[] };

/** Merges click paths into a prefix tree; chains without branches or features are joined ("A › B"). */
function pathTree(features: Feature[]): TreeNodeData[] {
  const root: TreeNodeData = { label: "", children: [], features: [] };
  for (const f of features) {
    let node = root;
    for (const step of f.click_path) {
      let next = node.children.find((c) => c.label === step);
      if (!next) node.children.push((next = { label: step, children: [], features: [] }));
      node = next;
    }
    node.features.push(f);
  }
  const compress = (n: TreeNodeData): TreeNodeData => {
    let cur = n;
    while (cur.children.length === 1 && cur.features.length === 0) {
      const only = cur.children[0];
      cur = { label: `${cur.label} › ${only.label}`, children: only.children, features: only.features };
    }
    return { ...cur, children: cur.children.map(compress) };
  };
  return root.children.map(compress);
}

function TreeNode({ node }: { node: TreeNodeData }) {
  return (
    <li className="relative">
      <div className="flex flex-wrap items-center gap-2 py-0.5">
        <span className={node.children.length ? "font-medium" : ""}>{node.label}</span>
        {node.features.map((f) => (
          <span key={f.id} className="inline-flex items-center gap-1.5 rounded-full bg-[#FF8A3D]/15 px-2 py-0.5 text-xs font-medium">
            <span aria-hidden className="text-[#FF8A3D]">●</span>{f.name}
            {f.required_roles?.length ? <span className="text-muted">· {f.required_roles.join(", ")}</span> : null}
          </span>
        ))}
      </div>
      {node.children.length > 0 && (
        <ul className="ml-2 space-y-1 border-l border-line pl-4">
          {node.children.map((c) => <TreeNode key={c.label} node={c} />)}
        </ul>
      )}
    </li>
  );
}

function Roles({ roles }: { roles: string[] | null }) {
  if (!roles?.length) return <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">all</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {roles.map((r) => <span key={r} className="rounded-full bg-[#127A86]/15 px-2 py-0.5 text-xs font-medium">{r}</span>)}
    </span>
  );
}
