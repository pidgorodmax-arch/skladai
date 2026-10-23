// Impostazioni: підключення до Google Таблиці клієнта (Apps Script Web App).
// Адреса й токен зберігаються лише в цьому браузері — див. data/settings.ts.

import { useState, type FormEvent } from 'react'
import { validateSettings } from '../data/settings'
import { SheetsError, testConnection } from '../data/sheetsSource'
import { useConnection } from '../data/useConnection'

type Check = { kind: 'idle' } | { kind: 'checking' } | { kind: 'error'; message: string }

export default function Settings() {
  const { settings, connect, disconnect } = useConnection()
  const [url, setUrl] = useState(settings?.url ?? '')
  const [token, setToken] = useState('')
  const [check, setCheck] = useState<Check>({ kind: 'idle' })

  async function submit(e: FormEvent) {
    e.preventDefault()
    const draft = { url, token }
    const invalid = validateSettings(draft)
    if (invalid) {
      setCheck({ kind: 'error', message: invalid })
      return
    }
    setCheck({ kind: 'checking' })
    try {
      // Спершу перевіряємо, що таблиця відповідає, і лише тоді перемикаємось:
      // інакше застосунок «застрягне» на помилці завантаження.
      await testConnection(draft)
      connect(draft)
    } catch (err) {
      setCheck({ kind: 'error', message: err instanceof SheetsError ? err.message : 'Connessione non riuscita' })
    }
  }

  return (
    <main className="phone-page">
      <div>
        <h1>Impostazioni</h1>
      </div>

      <section className="card" aria-labelledby="s-source">
        <h2 id="s-source">Origine dei dati</h2>
        {settings ? (
          <>
            <p>
              <span className="chip ok">Tabella Google collegata</span>
            </p>
            <p className="muted" style={{ overflowWrap: 'anywhere' }}>{settings.url}</p>
            <button type="button" className="btn" onClick={disconnect}>
              Scollega e usa i dati demo
            </button>
          </>
        ) : (
          <p>
            <span className="chip info">Dati demo in questo browser</span>
          </p>
        )}
      </section>

      <form className="card" onSubmit={submit} style={{ gap: 14 }} aria-labelledby="s-connect">
        <h2 id="s-connect">{settings ? 'Cambia tabella' : 'Collega la tabella Google'}</h2>
        <div className="field">
          <label htmlFor="s-url">Indirizzo dello script (finisce con /exec)</label>
          <input
            id="s-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://script.google.com/macros/s/…/exec"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="s-token">Token</label>
          <input id="s-token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
        </div>
        <p className="muted" style={{ fontSize: 14 }}>
          Indirizzo e token restano solo su questo dispositivo. Non condividerli.
        </p>
        {check.kind === 'error' && (
          <div className="chip bad" role="alert" style={{ whiteSpace: 'normal' }}>
            {check.message}
          </div>
        )}
        <button type="submit" className="btn primary" disabled={check.kind === 'checking'}>
          {check.kind === 'checking' ? 'Verifica in corso…' : 'Verifica e collega'}
        </button>
      </form>
    </main>
  )
}
