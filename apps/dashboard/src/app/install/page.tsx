import { existsSync } from "node:fs";
import path from "node:path";
import { Shell } from "@/components/Shell";
import { Button, ButtonLink, Card, Notice, PRODUCT_NAME } from "@/components/ui";

const ZIP = "/valo-extension.zip";

const STEPS: [string, React.ReactNode][] = [
  ["Download and unzip", <>Download the ZIP file below and unzip it into a folder you keep (for example Documents).</>],
  ["Turn on Developer mode", <>Open <code className="rounded-[4px] bg-surface-2 px-1.5 py-px font-mono text-sm">chrome://extensions</code> in Chrome and switch on “Developer mode” in the top right.</>],
  ["Load the folder", <>Click “Load unpacked” and choose the unzipped folder.</>],
  ["Pin and sign in", <>Pin {PRODUCT_NAME} in the toolbar, reload your app page and sign in with your {PRODUCT_NAME} account. <kbd className="font-mono">⌘⇧L</kbd> (Mac) or <kbd className="font-mono">Alt+L</kbd> opens {PRODUCT_NAME}.</>],
];

export default function InstallPage() {
  // The ZIP is built and copied into public/ during deployment (ci.valo.yml), before `next build` – checked at build time.
  const available = existsSync(path.join(process.cwd(), "public", ZIP.slice(1)));
  return (
    <Shell href="/install" title={`Install the ${PRODUCT_NAME} extension`} intro={`${PRODUCT_NAME} runs in Chrome next to your company apps. Installing takes about two minutes.`}>
      <Card className="grid gap-5">
        <div className="flex flex-wrap items-center gap-4">
          {available ? (
            <ButtonLink href={ZIP} download="valo-extension.zip">Download {PRODUCT_NAME} for Chrome</ButtonLink>
          ) : (
            <>
              <Button type="button" disabled>Download {PRODUCT_NAME} for Chrome</Button>
              <span className="text-sm text-muted">Built during deployment</span>
            </>
          )}
        </div>
        <ol className="m-0 grid list-none grid-cols-2 gap-4 p-0">
          {STEPS.map(([title, text], i) => (
            <li key={title} className="grid content-start gap-2 rounded-[10px] border border-line p-[18px]">
              <span className="text-xs font-semibold text-muted">Step {i + 1}</span>
              <span className="font-semibold">{title}</span>
              <p className="m-0">{text}</p>
            </li>
          ))}
        </ol>
      </Card>
      <Notice>
        <p className="m-0 text-sm text-muted">Chrome doesn&apos;t allow one-click installs from websites. For company-wide rollout IT can force-install {PRODUCT_NAME} via Chrome policy.</p>
      </Notice>
    </Shell>
  );
}
