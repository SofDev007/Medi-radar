import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import { PASS_PLANS } from '@shared/passes.js';
import { adminAPI, errorMessage } from '@/lib/api';
import { PageHeader } from '@/components/Layout';
import { Stamp, EmptyTicket, RuledLines } from '@/components/ticket';

const day = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
const planLabel = (id) => PASS_PLANS[id]?.label || id;

function PassCell({ pass }) {
  if (pass.status === 'active') {
    return (
      <div>
        <Stamp kind="approved">Active</Stamp>
        <div className="text-[13px] text-ink-soft mt-1">{planLabel(pass.plan)} · until {day(pass.validUntil)}</div>
      </div>
    );
  }
  if (pass.status === 'expired') {
    return (
      <div>
        <Stamp kind="stale">Expired</Stamp>
        <div className="text-[13px] text-ink-soft mt-1">{planLabel(pass.plan)} · ended {day(pass.validUntil)}</div>
      </div>
    );
  }
  return <span className="text-ink-faint">No pass</span>;
}

/** Passenger accounts: who signs in to the passenger app, and who holds a bus pass. */
export default function Passengers() {
  const [passengers, setPassengers] = useState(null);

  const load = () => adminAPI.passengers().then((r) => setPassengers(r.data)).catch((e) => { setPassengers([]); toast.error(errorMessage(e)); });
  useEffect(() => { load(); }, []);

  const active = passengers?.filter((p) => p.pass.status === 'active').length || 0;
  const revenue = passengers?.reduce((sum, p) => sum + p.totalSpent, 0) || 0;

  return (
    <>
      <PageHeader title="Passengers" actions={<button type="button" className="btn btn-ghost" onClick={() => { setPassengers(null); load(); }}><RefreshCw size={18} /> Refresh</button>}>
        People signed in to the passenger app, most recently active first
        {passengers?.length > 0 && <> — <span className="font-semibold text-ink">{passengers.length}</span> accounts, <span className="font-semibold text-ink">{active}</span> with an active pass, <span className="font-semibold text-ink">₹{revenue.toLocaleString('en-IN')}</span> in pass sales</>}.
      </PageHeader>

      {passengers === null ? <RuledLines rows={8} /> : passengers.length === 0 ? (
        <EmptyTicket title="No passengers yet">Passengers appear here after they sign in to the passenger app with Google or email.</EmptyTicket>
      ) : (
        <div className="ticket overflow-x-auto">
          <table className="waybill">
            <thead><tr><th>Passenger</th><th>Sign-in</th><th>Joined</th><th>Last active</th><th>Bus pass</th><th className="text-right">Purchases</th><th className="text-right">Total spent</th></tr></thead>
            <tbody>
              {passengers.map((p) => (
                <tr key={p._id} className={p.isActive ? '' : 'opacity-60'}>
                  <td>
                    <div className="flex items-center gap-3">
                      {p.avatarUrl
                        ? <img src={p.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" referrerPolicy="no-referrer" />
                        : <span className="h-8 w-8 rounded-full grid place-items-center bg-paper font-semibold text-[13px]" aria-hidden="true">{p.name?.[0]?.toUpperCase()}</span>}
                      <div><div className="font-semibold">{p.name}</div><div className="text-[13px] text-ink-soft">{p.email}</div></div>
                    </div>
                  </td>
                  <td>{p.authProvider === 'google' ? 'Google' : 'Email'}</td>
                  <td className="whitespace-nowrap">{day(p.createdAt)}</td>
                  <td className="whitespace-nowrap tabular-nums">{when(p.lastLoginAt)}</td>
                  <td><PassCell pass={p.pass} /></td>
                  <td className="text-right tabular-nums">{p.purchases}</td>
                  <td className="text-right tabular-nums font-semibold">₹{p.totalSpent.toLocaleString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
