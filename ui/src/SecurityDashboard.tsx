import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronDown, CircleHelp, Globe, LockKeyhole, RefreshCw, Search } from 'lucide-react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { BreachConsentDialog } from './dialogs';
import { call, type BreachFinding, type EntryView, type SecurityFinding, type SecurityReport } from './bridge';
import './security.css';

type Filter = 'review' | 'reused' | 'weak' | 'unassessed' | 'breached';

export function SecurityDashboard({ refreshKey, entries, onSelect }: { refreshKey: number; entries: EntryView[]; onSelect: (id: string) => void }) {
  const [report, setReport] = useState<SecurityReport | null>(null);
  const [breaches, setBreaches] = useState<BreachFinding[] | null>(null);
  const [filter, setFilter] = useState<Filter>('review');
  const [query, setQuery] = useState('');
  const [consent, setConsent] = useState(false);
  const [analyzing, setAnalyzing] = useState(true);
  const [checking, setChecking] = useState(false);
  const [scanId, setScanId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const scanGeneration = useRef(0);
  const breachGeneration = useRef(0);
  const queueHeading = useRef<HTMLHeadingElement>(null);

  const refreshLocal = async () => {
    const generation = scanGeneration.current;
    setAnalyzing(true); setError('');
    try {
      const result = await call('securityAnalyze');
      if (generation === scanGeneration.current) { setReport(result); setCheckedAt(new Date()); }
    } catch (e) { if (generation === scanGeneration.current) setError((e as Error).message); }
    finally { if (generation === scanGeneration.current) setAnalyzing(false); }
  };
  useEffect(() => {
    scanGeneration.current++; setReport(null); setBreaches(null); setChecking(false); setScanId(null); setConsent(false); setNotice(''); setFilter('review'); setQuery('');
    void refreshLocal();
    return () => { scanGeneration.current++; };
  }, [refreshKey]);
  useEffect(() => {
    if (!scanId) return;
    return () => { void call('breachCancel', { scanId }).catch(() => {}); };
  }, [scanId]);

  const checkBreaches = async () => {
    const generation = scanGeneration.current;
    const run = ++breachGeneration.current;
    const current = () => generation === scanGeneration.current && run === breachGeneration.current;
    setConsent(false); setChecking(true); setBreaches(null); setError(''); setNotice(''); setFilter('review');
    try {
      const id = await call('breachStart');
      if (!current()) { await call('breachCancel', { scanId: id }); return; }
      setScanId(id);
      while (true) {
        await new Promise(resolve => setTimeout(resolve, 200));
        const status = await call('breachStatus', { scanId: id });
        if (!current()) break;
        if (status.status === 'completed') { setBreaches(status.results ?? []); setNotice('Online check complete. Results are kept only for this session.'); break; }
        if (status.status === 'canceled') { setNotice('Breached-password check canceled.'); break; }
      }
    } catch (e) { if (current()) setError((e as Error).message); }
    finally { if (current()) { setChecking(false); setScanId(null); } }
  };
  const cancel = () => {
    if (!scanId) return;
    breachGeneration.current++; setScanId(null); setChecking(false); setBreaches(null); setNotice('Breached-password check canceled.');
  };

  const breachedIds = new Set(breaches?.filter(b => b.state === 'found').map(b => b.id));
  const needsReview = (f: SecurityFinding) => f.weak || f.reused || !f.assessed || breachedIds.has(f.id);
  const priority = (f: SecurityFinding) => (breachedIds.has(f.id) ? 8 : 0) + (f.reused ? 4 : 0) + (f.weak ? 2 : 0) + (!f.assessed ? 1 : 0);
  const review = (report?.findings.filter(needsReview) ?? []).sort((a, b) => priority(b) - priority(a) || a.title.localeCompare(b.title));
  const counts: Record<Filter, number> = { review: review.length, reused: report?.reused ?? 0, weak: report?.weak ?? 0, unassessed: report?.notAssessed ?? 0, breached: breachedIds.size };
  const filters: { key: Filter; label: string }[] = [
    { key: 'review', label: 'Needs review' }, { key: 'reused', label: 'Reused' }, { key: 'weak', label: 'Weak' }, { key: 'unassessed', label: 'Not assessed' },
    ...(breaches ? [{ key: 'breached' as const, label: 'Breached' }] : []),
  ];
  const visible = review.filter(f => (filter === 'review' || (filter === 'reused' && f.reused) || (filter === 'weak' && f.weak) || (filter === 'unassessed' && !f.assessed) || (filter === 'breached' && breachedIds.has(f.id))) &&
    `${f.title} ${entries.find(e => e.id === f.id)?.username ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const selectFilter = (next: Filter) => { setFilter(next); setQuery(''); queueHeading.current?.focus(); };
  const openSite = async (id: string) => {
    const generation = scanGeneration.current;
    setError('');
    try {
      await call('openSite', { id });
      if (generation === scanGeneration.current) setNotice('Change your password on the site, then approve the LocalVault extension’s update prompt. If no prompt appears, edit the saved password here.');
    } catch (e) { if (generation === scanGeneration.current) setError((e as Error).message); }
  };

  return <div className="security-dashboard min-h-0 min-w-0 flex-1 overflow-y-auto" data-ui>
    <div className="security-shell">
      <header className="security-header">
        <div><h1>Security</h1><p>{report?.total ?? '—'} active passwords · On-device analysis{checkedAt ? ` · ${checkedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</p></div>
        <Button variant="ghost" size="sm" aria-label="Refresh local check" title="Refresh local check" onClick={() => void refreshLocal()} disabled={analyzing}><RefreshCw size={15} className={analyzing ? 'animate-spin' : ''} /><span>{analyzing ? 'Checking…' : 'Refresh'}</span></Button>
      </header>
      {error && <p role="alert" className="security-error">{error}</p>}
      <BreachPanel entries={entries} onOpenSite={id => void openSite(id)} breaches={breaches} total={report?.total ?? 0} checking={checking} canCancel={!!scanId} notice={notice}
        onCheck={() => setConsent(true)} onCancel={cancel} onReview={() => selectFilter('breached')} onSelect={onSelect} />
      <section className="security-queue" aria-labelledby="security-queue-heading">
          <div className="security-section-heading"><h2 id="security-queue-heading" ref={queueHeading} tabIndex={-1}>{report ? `${review.length} account${review.length === 1 ? ' needs' : 's need'} review` : 'Password review'}</h2>
            {review.length > 0 && <Button variant="ghost" size="sm" onClick={() => onSelect(review[0].id)}>Review next password <ArrowRight size={14} className="rtl:rotate-180" /></Button>}
          </div>
          <div className="security-filters" role="group" aria-label="Filter security findings">{filters.map(f => <button key={f.key} aria-pressed={filter === f.key} onClick={() => selectFilter(f.key)}>{f.label}<span className="tabular-nums">{counts[f.key]}</span></button>)}</div>
          {review.length > 4 && <div className="relative mb-2"><Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search security findings" placeholder="Find an account" value={query} onChange={e => setQuery(e.target.value)} className="ps-9" /></div>}
          {!report ? <p role="status" className="security-empty">{analyzing ? 'Reviewing active login passwords…' : 'Local review unavailable. Try refreshing.'}</p> : visible.length ? <ul className="security-findings">{visible.map(f => {
            const entry = entries.find(e => e.id === f.id);
            const breached = breachedIds.has(f.id);
            return <li key={f.id} className="security-finding-row"><button className="security-finding" aria-label={`Review ${f.title}`} onClick={() => onSelect(f.id)}>
              <span className="security-finding-content"><span className="security-account-title">{f.title}</span>{entry?.username && <span className="security-account-user">{entry.username}</span>}
                <span className="security-reason">{breached ? 'Found in breaches — change this password first.' : f.reused ? 'Reused — give this account a unique password.' : f.weak ? 'Weak — use a longer, unique password.' : 'Over the 1,024-character analysis limit — review manually.'}</span>
                <span className="security-finding-tags">{breached && <span className="security-tag-danger">Breached</span>}{f.reused && <span className="security-tag-warning">Reused</span>}{f.weak && <span className="security-tag-warning">Weak</span>}{!f.assessed && <span>Not assessed</span>}</span>
              </span><ArrowRight className="security-row-arrow rtl:rotate-180" size={16} aria-hidden="true" />
            </button>{breached && <Button variant="outline" size="sm" className="security-site-action" aria-label={`Go to site for ${f.title}`} disabled={!entry?.origin} title={entry?.origin ?? 'Add an HTTPS website to this account first'} onClick={() => void openSite(f.id)}>Go to site</Button>}</li>;
          })}</ul> : <div className="security-empty"><h3>{query ? 'No matching accounts' : filter === 'review' ? 'You’re caught up here' : `No ${filter === 'unassessed' ? 'unassessed' : filter} passwords found`}</h3><p>{query ? 'Try a different account name or username.' : 'This is a finding from this check, not a guarantee of safety.'}</p>{filter !== 'review' && <Button variant="ghost" onClick={() => selectFilter('review')}>Back to all findings <ArrowRight size={14} className="rtl:rotate-180" /></Button>}</div>}
          <details className="security-disclosure"><summary><CircleHelp size={15} />What does this review cover?<ChevronDown size={14} /></summary><div><p>Only active login passwords are checked. Notes, custom fields, previous versions, and Trash are excluded.</p><p>Strength scores of 0–2 are flagged weak. Passwords over 1,024 characters are not assessed. Reuse means an exact match across saved accounts.</p></div></details>
      </section>
    </div>
    <BreachConsentDialog open={consent} onClose={() => setConsent(false)} onContinue={() => void checkBreaches()} />
  </div>;
}

function BreachPanel({ entries, onOpenSite, breaches, total, checking, canCancel, notice, onCheck, onCancel, onReview, onSelect }: {
  entries: EntryView[]; onOpenSite: (id: string) => void; breaches: BreachFinding[] | null; total: number; checking: boolean; canCancel: boolean; notice: string;
  onCheck: () => void; onCancel: () => void; onReview: () => void; onSelect: (id: string) => void;
}) {
  const [resultFilter, setResultFilter] = useState<BreachFinding['state'] | 'all' | null>(null);
  useEffect(() => { setResultFilter(null); }, [breaches]);
  const found = breaches?.filter(b => b.state === 'found').length ?? 0;
  const unavailable = breaches?.filter(b => b.state === 'unavailable').length ?? 0;
  const activeFilter = resultFilter ?? (found ? 'found' : unavailable ? 'unavailable' : 'all');
  const results = breaches?.filter(b => activeFilter === 'all' || b.state === activeFilter) ?? [];
  return <section className="breach-feature" aria-labelledby="security-online-heading" data-outcome={found ? 'found' : unavailable ? 'partial' : 'idle'}>
    <div className="breach-topline">
      <Globe size={18} aria-hidden="true" />
      <div className="breach-status"><h2 id="security-online-heading">Breached passwords</h2><p role="status">{checking ? 'Checking for known breaches…' : breaches ? found ? `${found} password${found === 1 ? '' : 's'} found in breaches` : unavailable ? 'Some passwords could not be checked' : 'No matches found in this check' : 'Not checked in this session'}</p></div>
      <div className="breach-actions"><Button size="sm" variant="outline" disabled={checking || !total} onClick={onCheck}>{checking ? 'Checking…' : 'Check breached passwords'}</Button>
        {checking && <Button size="sm" variant="ghost" disabled={!canCancel} onClick={onCancel}>Cancel check</Button>}
        {!checking && found > 0 && <Button size="sm" variant="ghost" onClick={onReview}>Review exposed passwords <ArrowRight size={14} className="rtl:rotate-180" /></Button>}
      </div>
    </div>
    {notice && <p className="breach-notice" role="status">{notice}</p>}
    {breaches && <details className="breach-results">
      <summary>Scan results · {found} found · {breaches.filter(b => b.state === 'notFound').length} not found · {unavailable} unavailable<ChevronDown size={13} /></summary>
      <div className="breach-result-filters security-filters" role="group" aria-label="Filter breach results">{([
        { state: 'found', label: 'Found', count: found },
        { state: 'notFound', label: 'Not found', count: breaches.filter(b => b.state === 'notFound').length },
        { state: 'unavailable', label: 'Unavailable', count: unavailable },
      ] as const).map(category => <button key={category.state} aria-pressed={activeFilter === category.state} onClick={() => setResultFilter(category.state)}>{category.label}<span>{category.count}</span></button>)}<button onClick={() => setResultFilter('all')} aria-pressed={activeFilter === 'all'}>Show all · {breaches.length}</button></div>
      <div className="breach-result-list">{results.length ? <ul>{results.map(b => <li key={b.id} className="breach-result-row"><button className="breach-result" aria-label={`Open breach result for ${b.title}`} onClick={() => onSelect(b.id)}><strong>{b.title}</strong><span>{b.state === 'found' ? `Found${b.count ? ` · ${b.count.toLocaleString()} times` : ''}` : b.state === 'notFound' ? 'Not found' : 'Unavailable'}</span><ArrowRight size={14} className="rtl:rotate-180" aria-hidden="true" /></button>{b.state === 'found' && <Button variant="outline" size="sm" className="security-site-action" aria-label={`Go to site for ${b.title}`} disabled={!entries.find(e => e.id === b.id)?.origin} onClick={() => onOpenSite(b.id)}>Go to site</Button>}</li>)}</ul> : <p className="breach-notice">No passwords in this result category.</p>}</div>
    </details>}
    {unavailable > 0 && <p className="breach-partial">Some requests were unavailable. Retry the check; unavailable results are not clear.</p>}
    <details className="security-disclosure breach-privacy"><summary><LockKeyhole size={13} />Privacy &amp; limits<ChevronDown size={13} /></summary><div><p>Each online check requires permission. Have I Been Pwned receives your IP address and a five-character SHA-1 hash prefix, never your password, full hash, username, or website. Matches are compared locally.</p><p>“Not found” does not mean safe. Results stay in memory until the vault locks or changes.</p></div></details>
  </section>;
}
