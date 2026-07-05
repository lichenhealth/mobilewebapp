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

// ─── KOC: Kaleidoscope of Care (weekly plan) ────────────────────────
// Items use a tiny markup syntax inside their `text` field:
//   [phrase]      → peach-underlined "intervention" link
//   {icon-name}   → small inline icon (any IconName)

export interface CareItem {
  text: string;
}

export interface ProviderContribution {
  handle: string;
  items: CareItem[];
}

export interface CarePlanDay {
  label: string;            // "Daily", "Monday, 5/19", etc.
  providers: ProviderContribution[];
}

export interface CarePlan {
  dateRange: string;        // "5/18/26 - 5/23/26"
  patient: { name: string; monogram: string; color: string };
  days: CarePlanDay[];
}

export const WEEK_CARE_PLAN_FORWARD_DECL = null; // real declaration below — keep this to satisfy lint

// ─── Concierge Chat (care team + AI assistant) ──────────────────────
// A dedicated thread between the user, their care providers, and their
// AI assistant. Lives at /concierge/chat (NOT the same as the global /chat).

export type ChatSender = 'self' | 'provider' | 'ai';

export interface ChatMessage {
  id: string;
  sender: ChatSender;
  authorName: string;
  authorMonogram?: string;
  authorColor?: string;
  /** Body text. Supports:
   *    @handle      → peach mention
   *    [phrase]     → peach-underlined link
   *    \n\n         → paragraph break */
  text: string;
  time: string;
}

export interface ChatDay {
  label: string;       // "Thursday, May 17th"
  messages: ChatMessage[];
}

export const CONCIERGE_CHAT: ChatDay[] = [
  {
    label: 'Thursday, May 17th',
    messages: [
      {
        id: 'm1',
        sender: 'self',
        authorName: 'Crystal Jones',
        authorMonogram: 'C',
        authorColor: '#7E6B96',
        text: 'Hey Team, I\u2019m feeling much better than last week and haven\u2019t had any challenges integrating the supplements @cherlynnresager suggested.',
        time: '12:23 pm',
      },
      {
        id: 'm2',
        sender: 'provider',
        authorName: 'Payton Skawinski',
        authorMonogram: 'P',
        authorColor: '#6B8A9C',
        text: 'Awesome! I just wrote up a prescription for the dynamite supplements, which are naturopathic but should get some insurance coverage, @crystaljones.',
        time: '1:53 pm',
      },
      {
        id: 'm3',
        sender: 'ai',
        authorName: 'Crystal Jones\u2019 AI Assistant',
        text:
          'Good news! @crystaljones\u2019 insurance covers 80% of @dynamite\u2019s [Daily Foundations Pack]. I\u2019ve attached the complete Aetna claim for her to submit.\n\n' +
          'Just FYI: Fellow founder @mindyyadav has a very similar profile and finds the following sleep meditation to augment the supplements nicely.\n\n' +
          'Also, fellow founder @markbrown has a solution to one of your roadblocks and you have one for his. I\u2019ve created a collaborative business plan for you to review to see if you would like to propose a collaboration. Happy to facilitate an intro.',
        time: '2:14 pm',
      },
      {
        id: 'm4',
        sender: 'provider',
        authorName: 'Cherlynn Resager',
        authorMonogram: 'C',
        authorColor: '#7C8A6D',
        text:
          'Wonderful progress, @crystaljones. Keep the smoothies + supplements going through the weekend, and let\u2019s plan a check-in next Tuesday.',
        time: '3:08 pm',
      },
    ],
  },
];

export const WEEK_CARE_PLAN: CarePlan = {
  dateRange: '5/18/26 \u2013 5/23/26',
  patient: { name: 'Kelly Bolton', monogram: 'K', color: '#7E6B96' },
  days: [
    {
      label: 'Daily',
      providers: [
        {
          handle: '@CherlynnResager',
          items: [
            { text: '[Green Smoothie] {fork-spoon} (1x day/am)' },
            { text: '[Dynamite Supplements] (DM Plus am/Tri-Mins pm)' },
            { text: '30 minutes on the [biomat] at [Lichen Bainbridge Island] (PM, if possible)' },
          ],
        },
        {
          handle: '@GalynBurke',
          items: [
            { text: '[Inner Child Meditation] {mic}' },
          ],
        },
        {
          handle: '@PaytonSkawinski',
          items: [
            { text: 'Stay at [50mg Zoloft], daily' },
          ],
        },
      ],
    },
    {
      label: 'Monday, 5/19',
      providers: [
        {
          handle: '@GalynBurke',
          items: [
            { text: '[Polaris Heal the Healer Module] {graduation-cap}' },
          ],
        },
        {
          handle: '@PaytonSkawinski',
          items: [
            { text: '3pm [blood draw] at [Lynwood Office] {calendar} {location}' },
          ],
        },
      ],
    },
    {
      label: 'Tuesday, 5/20',
      providers: [
        {
          handle: '@ZiaSparkleheart',
          items: [
            { text: '[Huachuma Ceremony] at [Lichen Bainbridge Island]' },
            { text: 'No food after midnight on Monday. No other mind-altering substances within 24 hours of ceremony.' },
          ],
        },
      ],
    },
    {
      label: 'Wednesday, 5/21',
      providers: [
        {
          handle: '@CherlynnResager',
          items: [
            { text: 'Recovery day. Hydrate, [bone broth] {fork-spoon}, gentle movement only.' },
          ],
        },
      ],
    },
    {
      label: 'Thursday, 5/22',
      providers: [
        {
          handle: '@GalynBurke',
          items: [
            { text: '[Somatic Therapy] {mic} \u2014 60 min, 2pm' },
          ],
        },
      ],
    },
    {
      label: 'Friday, 5/23',
      providers: [
        {
          handle: '@PaytonSkawinski',
          items: [
            { text: 'Weekly check-in {calendar} \u2014 4pm telehealth' },
          ],
        },
      ],
    },
  ],
};
