//! The Wwise-style game-engine integration surface (desktop app only).
//! Link a Godot 4 project, install/update the `addons/loom` runtime in
//! it, and build the open workspace's story into `.loombank` +
//! `LoomIDs.gd` artifacts inside the game project.

import { useEffect } from 'react'
import { useGodot } from '@/store/godot'
import { desktopFs } from '@/lib/desktop'

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
      {children}
    </section>
  )
}

const button =
  'rounded-lg border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800 disabled:cursor-default disabled:opacity-40'
const field =
  'w-40 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm outline-none focus:border-indigo-500'

export function GodotPanel() {
  const s = useGodot()
  const { projectPath, status, busy } = s
  const refresh = useGodot((st) => st.refresh)

  useEffect(() => {
    if (projectPath) void refresh()
  }, [projectPath, refresh])

  if (!projectPath) {
    return (
      <Card title="Game engine — Godot">
        <p className="mb-3 text-sm text-zinc-500">
          Link a Godot 4 project to integrate this story the way Wwise integrates audio: Loom installs its runtime
          addon into the game project and builds story banks (<code className="text-zinc-400">.loombank</code> +{' '}
          <code className="text-zinc-400">LoomIDs.gd</code>) straight into it.
        </p>
        <button className={button} onClick={() => void s.pickProject()} disabled={busy !== null}>
          {busy === 'pick' ? 'Choosing…' : 'Link Godot project…'}
        </button>
        {s.error && <div className="mt-3 rounded bg-red-950 px-3 py-2 text-xs text-red-300">{s.error}</div>}
      </Card>
    )
  }

  const updateAvailable =
    status?.addonInstalled &&
    status.bundledAddonVersion !== null &&
    status.addonVersion !== status.bundledAddonVersion

  return (
    <div className="flex flex-col gap-4">
      <Card title="Game engine — Godot">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm text-zinc-200">{status?.name ?? 'Godot project'}</div>
            <div className="truncate text-xs text-zinc-500">{projectPath}</div>
          </div>
          <div className="flex shrink-0 gap-2">
            <button className={button} onClick={() => void desktopFs.reveal(projectPath)}>
              Reveal
            </button>
            <button className={button} onClick={() => s.unlink()}>
              Unlink
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-3 border-t border-zinc-900 pt-3">
          <span className="text-sm text-zinc-400">
            Runtime addon:{' '}
            {status?.addonInstalled ? (
              <span className="text-emerald-300">
                installed{status.addonVersion ? ` v${status.addonVersion}` : ''}
                {updateAvailable ? ` — v${status.bundledAddonVersion} available` : ''}
              </span>
            ) : (
              <span className="text-amber-300">not installed</span>
            )}
          </span>
          <button className={button} onClick={() => void s.installAddon()} disabled={busy !== null}>
            {busy === 'install'
              ? 'Installing…'
              : status?.addonInstalled
                ? updateAvailable
                  ? 'Update addon'
                  : 'Reinstall addon'
                : 'Install addon'}
          </button>
        </div>
        {status && !status.pluginEnabled && status.addonInstalled && (
          <p className="mt-2 text-xs text-zinc-500">
            The editor plugin isn't enabled in project.godot — runtime nodes work regardless, but exported builds
            need it so <code>.loombank</code> assets are packed. “Install addon” enables it.
          </p>
        )}
        {s.error && <div className="mt-3 rounded bg-red-950 px-3 py-2 text-xs text-red-300">{s.error}</div>}
      </Card>

      <Card title="Story banks">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            Bank name
            <input className={field} value={s.bankName} onChange={(e) => s.setBankName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            Folder in project
            <input className={field} value={s.bankFolder} onChange={(e) => s.setBankFolder(e.target.value)} />
          </label>
          <button
            className={`${button} border-indigo-700 text-indigo-200`}
            onClick={() => void s.buildBanks()}
            disabled={busy !== null || !status?.addonInstalled}
          >
            {busy === 'build' ? 'Building…' : 'Build banks'}
          </button>
        </div>
        {!status?.addonInstalled && (
          <p className="mt-2 text-xs text-zinc-500">Install the runtime addon first.</p>
        )}

        {s.lastBuild && (
          <div className="mt-3 border-t border-zinc-900 pt-3 text-xs">
            {s.lastBuild.errors.length > 0 ? (
              <div className="rounded bg-red-950 px-3 py-2 text-red-300">
                Build failed — nothing written.
                {s.lastBuild.errors.map((e, i) => (
                  <div key={i} className="mt-1 font-mono">{e}</div>
                ))}
              </div>
            ) : (
              <div className="text-zinc-400">
                Wrote{' '}
                {s.lastBuild.written.map((w, i) => (
                  <span key={w}>
                    {i > 0 && ', '}
                    <code className="text-zinc-300">{w}</code>
                  </span>
                ))}{' '}
                — {s.lastBuild.programs} programs, {s.lastBuild.texts} texts, {s.lastBuild.hooks} hooks.
              </div>
            )}
            {s.lastBuild.warnings.map((w, i) => (
              <div key={i} className="mt-1 font-mono text-amber-300">{w}</div>
            ))}
          </div>
        )}

        {status && status.banks.length > 0 && (
          <div className="mt-3 border-t border-zinc-900 pt-3">
            <div className="mb-1 text-xs text-zinc-500">Banks in the project</div>
            {status.banks.map((b) => (
              <div key={b.path} className="flex items-center justify-between text-xs">
                <code className="text-zinc-300">{b.path}</code>
                <span className="text-zinc-600">
                  {b.modifiedMs > 0 ? new Date(b.modifiedMs).toLocaleString() : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
