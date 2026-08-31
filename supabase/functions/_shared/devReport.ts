// file_dev_report — the bug bridge (founder 2026-08-24). When a member
// tells an assistant something is broken, the assistant files it into
// dev_reports with the context it can see; the builder Claude reads the
// queue at the start of every terminal session. Shared by assistant-feed
// and claude-chat so the promise is identical everywhere.

export const FILE_DEV_REPORT_TOOL = {
  name: 'file_dev_report',
  description: 'File a bug or issue report to the Lichen builders (Galyn and the builder Claude, who reads the report queue at the start of every build session). Use when the member describes something broken, confusing, or misbehaving in the app — quote their own words in the details, plus what you can see from here (which room, what happened). After filing, tell them plainly: it is filed, the builders read the queue, and no fix or date is promised. Never file the same issue twice in one conversation.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'One line naming the issue, e.g. "Unread badge does not clear while inside the chat".' },
      details: { type: 'string', description: 'The member\'s own words plus observable context: what they did, what they expected, what happened instead.' },
    },
    required: ['summary', 'details'],
  },
};

type SbFn = (path: string, init?: RequestInit) => Promise<Response>;

const DAILY_REPORT_CAP = 10;

export async function fileDevReport(
  sb: SbFn, reporterId: string, via: string,
  input: Record<string, string>,
): Promise<{ ok: boolean; change?: string; error?: string }> {
  const summary = String(input.summary ?? '').trim().slice(0, 200);
  const details = String(input.details ?? '').trim().slice(0, 4000);
  if (!summary) return { ok: false, error: 'A report needs a one-line summary.' };
  // A stuck tool loop must not flood the queue.
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const capRes = await sb(
    `dev_reports?reporter_id=eq.${reporterId}&created_at=gte.${since.toISOString()}&select=id`,
    { headers: { Prefer: 'count=exact' } },
  );
  const used = Number(capRes.headers.get('content-range')?.split('/')[1] ?? '0');
  if (used >= DAILY_REPORT_CAP) {
    return { ok: false, error: 'Today\'s report limit is reached for this member — for anything urgent, the help room reaches a human directly.' };
  }
  const r = await sb('dev_reports', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ reporter_id: reporterId, via, summary, details: details || null }),
  });
  if (!r.ok) return { ok: false, error: 'The report would not save — worth telling the help room instead.' };
  return { ok: true, change: `filed a dev report: "${summary}"` };
}
