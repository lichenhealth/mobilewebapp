import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import {
  ALLOWANCE_LABELS, listAllowances, MONEY_CEILING_NOTE, revokeAllowance, type ProposalKind,
} from '../lib/assistantAllowanceApi';

// Every standing "Always allow" the member has given the assistant, each one
// revocable (founder 2026-11-08: "revocable in Profile → Privacy, where every
// standing allowance is listed"). Only the person's tap ever adds one.
export default function AssistantAllowances() {
  const { user } = useAuth();
  const me = user?.id ?? '';
  const [rows, setRows] = useState<{ kind: ProposalKind; created_at: string }[] | null>(null);
  useEffect(() => { if (me) void listAllowances(me).then(setRows); }, [me]);
  if (!me || rows === null) return null;
  return (
    <div className="prof__allow">
      {rows.length === 0 ? (
        <p className="prof__hint">Nothing yet. When Claude proposes something that needs your yes — sending Current-cy, trusting someone, joining a group — the card offers <b>Always allow</b>, and it would show up here.</p>
      ) : (
        <ul className="prof__allow-list">
          {rows.map((r) => (
            <li key={r.kind} className="prof__allow-row">
              <span>
                {ALLOWANCE_LABELS[r.kind]}
                {r.kind === 'send_currentcy' && <span className="prof__hint"> — {MONEY_CEILING_NOTE}</span>}
              </span>
              <button type="button" className="prof__linkbtn"
                onClick={() => void revokeAllowance(me, r.kind).then(() => setRows((x) => (x ?? []).filter((y) => y.kind !== r.kind)))}>
                Take back
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
