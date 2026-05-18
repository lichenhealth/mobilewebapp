/* ====================================================================
   LICHEN — Concierge / health snapshot data
   The WOW view shows a structured snapshot of the user's health across
   six dimensions, with summary text and per-section narratives.
==================================================================== */

import { IconName } from '../components/Icon';

export interface RadarAxis {
  label: string;
  icon: IconName;
  value: number; // 0-100
}

export interface SnapshotSection {
  title: string;          // "Mental", "Physical", etc.
  items: string[];        // numbered key findings
  /** Body text. Use {{ai:phrase}} to mark AI-assistant references that
   *  should render in peach (and dim when AI is toggled off). */
  body: string;
}

export interface HealthSnapshot {
  date: string;           // e.g. "Thurs, 5/30"
  patient: {
    name: string;
    monogram: string;
    color: string;
  };
  summary: string;
  axes: RadarAxis[];      // exactly 6
  sections: SnapshotSection[];
}

export const TODAY_SNAPSHOT: HealthSnapshot = {
  date: 'Thurs, 5/30',
  patient: {
    name: 'Kelly Bolton',
    monogram: 'K',
    color: '#7E6B96',
  },
  summary:
    'Anxiety surrounding job security and recent black mold exposure are triggering childhood wounding around neglect, abuse, parentification and poverty (ACES-8).',
  axes: [
    { label: 'Mental',    icon: 'brain',         value: 76 }, // top
    { label: 'Financial', icon: 'dollar',        value: 64 }, // top-right
    { label: 'Social',    icon: 'user-multiple', value: 53 }, // bottom-right
    { label: 'Spirit',    icon: 'leaf',          value: 93 }, // bottom
    { label: 'Physical',  icon: 'health',        value: 83 }, // bottom-left
    { label: 'Emotional', icon: 'smile',         value: 72 }, // top-left
  ],
  sections: [
    {
      title: 'Mental',
      items: ['Anxiety', 'Dissociation'],
      body:
        'Becks Anxiety Inventory (BIA) rose slightly, week/week. Kelly attributes feeling unsafe and poisoned in home due to black mold exposure as the main cause of uptick. {{ai:Kelly\u2019s AI Assistant}} filed a renter\u2019s insurance {{ai:claim}}. Kelly was reimbursed $3,974 in healthcare services surrounding mold exposure, which reduced her financial anxiety significantly, although job security remains a core stressor, which is exacerbating maladaptive, dissociative behaviors.',
    },
    {
      title: 'Physical',
      items: ['Elevated cortisol', 'Increased migraine frequency'],
      body:
        'Cortisol levels rose from 27 mcg/dL to 29 mcg/dL, just above the upper bound of normal (6\u201327 mcg/dL). Migraine frequency increased to 3\u20134 events per week, correlated with mold exposure days. {{ai:Kelly\u2019s AI Assistant}} flagged a possible histamine response pattern and recommended a follow-up panel.',
    },
    {
      title: 'Emotional',
      items: ['Hypervigilance', 'Sleep disruption'],
      body:
        'Sleep latency increased to 47 minutes (baseline 18). REM cycles fragmented across 3 of 7 nights. Self-reported irritability and tearfulness rose in line with cortisol. {{ai:Kelly\u2019s AI Assistant}} scheduled two restorative bodywork sessions with @lichen-bailey-CO at sliding scale.',
    },
  ],
};
