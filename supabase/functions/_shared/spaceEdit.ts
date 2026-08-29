// The space page-edit toolset, shared between assistant-feed (a steward's
// build thread) and claude-chat (a suggestions room, where a steward can ask
// Claude to apply a suggested change in place — founder 2026-08-22). One
// module so the two surfaces can never drift.
//
// ⚠ THE SAFETY RULE, held: no tool takes a target. The space id comes from
// the thread name (assistant-feed) or the chat row's party_space_id
// (claude-chat) — server-side facts the model cannot supply.

export const SPACE_CONTACT_FIELDS = ['website', 'email', 'phone', 'booking', 'hours', 'address', 'instagram', 'facebook'];
export const SPACE_TAGLINE_MAX = 90;

export type SpaceToolOutcome = { ok: boolean; change?: string; [k: string]: unknown };

/** The REST helper both functions already define: path → fetch Response,
 *  service-role headers included. */
export type SbFn = (path: string, init?: RequestInit) => Promise<Response>;

export const SPACE_PAGE_TOOLS = [
  {
    // READ BEFORE WRITE (founder 2026-08-28, after the assistant answered
    // "I don't have a way to read what's currently on the page — I can only
    // write to it" and asked her to paste her own page back to it). Every
    // set_* tool below is a FULL REPLACEMENT, so a write-only toolset makes
    // "change this phrase to that" impossible to do safely: the model either
    // guesses the surrounding text or overwrites it. The function could
    // always read (readSpacePage); nothing exposed it to the model.
    name: 'get_space_page',
    description:
      "Read what is CURRENTLY on this space's public page — its tagline, home welcome, story, "
      + 'tabs and their text, offerings, facilities, practical notes, team, colours, and contact '
      + 'details. CALL THIS FIRST whenever you are changing existing wording. Every set_ tool is a '
      + 'full replacement, so to reword one line you must read the whole value, change that line, '
      + 'and write the whole thing back. Never ask the person to paste their own page to you — read '
      + 'it. Takes no arguments.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'set_space_tagline',
    description: `Replace the space's public-page tagline — the one line under its name. Max ${SPACE_TAGLINE_MAX} characters. Empty string clears it. Returns the previous value so you can tell them what it used to say.`,
    input_schema: {
      type: 'object',
      properties: { tagline: { type: 'string', description: 'The new tagline. Empty string clears it.' } },
      required: ['tagline'],
    },
  },
  {
    name: 'set_space_home_summary',
    description: 'Replace the welcome paragraph(s) on the Home tab of the space\'s public page. When empty, Home opens with the first two paragraphs of its story — often what they want. Empty string clears it and goes back to that.',
    input_schema: {
      type: 'object',
      properties: { summary: { type: 'string', description: 'The Home welcome, paragraphs separated by a blank line. Empty string clears it.' } },
      required: ['summary'],
    },
  },
  {
    name: 'set_space_story',
    description: 'Replace the space\'s whole story — the long-form About text on its page. FULL REPLACE, not append: call get_space_page first and write back the entire story with your change in it, or you will delete the rest of it. The previous value also comes back in the result.',
    input_schema: {
      type: 'object',
      properties: { story: { type: 'string', description: 'The new story, short paragraphs separated by blank lines. Empty string clears it — only on an explicit ask.' } },
      required: ['story'],
    },
  },
  {
    name: 'set_space_description',
    description: 'Replace the space\'s short description — the few words under its name inside Lichen (what it is, who it\'s for). Distinct from the tagline (its public page) and the story (long-form). Empty string clears it.',
    input_schema: {
      type: 'object',
      properties: { description: { type: 'string', description: 'A sentence or two. Empty string clears it.' } },
      required: ['description'],
    },
  },
  {
    name: 'set_space_contact_field',
    description: `Set one of the space's public contact fields. Field must be one of: ${SPACE_CONTACT_FIELDS.join(', ')}. Empty value clears it.`,
    input_schema: {
      type: 'object',
      properties: {
        field: { type: 'string', enum: SPACE_CONTACT_FIELDS },
        value: { type: 'string', description: 'The new value, or an empty string to clear it.' },
      },
      required: ['field', 'value'],
    },
  },
  {
    name: 'move_space_section_photo',
    description: 'Move a photo from one tab of the space\'s page to another. Tabs: about, services, goods, contact, facilities. Pass empty string for to_section to remove the photo from its current tab.',
    input_schema: {
      type: 'object',
      properties: {
        from_section: { type: 'string', enum: ['about', 'services', 'goods', 'contact', 'facilities'] },
        to_section: { type: 'string', description: 'Destination tab, or empty string to remove.' },
      },
      required: ['from_section', 'to_section'],
    },
  },
  {
    name: 'move_space_photo_to_home_cover',
    description: 'Move a photo from a tab of the space\'s page to become its Home cover — the image that greets every visitor.',
    input_schema: {
      type: 'object',
      properties: { from_section: { type: 'string', enum: ['about', 'services', 'goods', 'contact', 'facilities'] } },
      required: ['from_section'],
    },
  },
  {
    name: 'set_space_section_photo_position',
    description: 'Adjust which part of a tab\'s photo shows in its frame. position: "top", "center", "bottom", or a number 0–100 (percent from the top — 0 shows the very top, 100 the very bottom). "Push it down so the face shows" usually means a SMALLER number.',
    input_schema: {
      type: 'object',
      properties: {
        section: { type: 'string', enum: ['about', 'services', 'goods', 'contact', 'facilities'] },
        position: { type: 'string', description: '"top" | "center" | "bottom" | "0"–"100"' },
      },
      required: ['section', 'position'],
    },
  },
  {
    name: 'set_space_page_tab',
    description: 'Create or rewrite a TAB on the space\'s public page — any tab they can name, not just the standard set. Matches an existing tab by title (case-insensitive); otherwise creates a custom tab. Passing an empty body AND empty lead REMOVES a written tab (built-in tabs fill themselves and cannot be written or removed here). Everything you write appears in the manual editor too — it is the same page.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The tab name as shown to visitors.' },
        lead: { type: 'string', description: 'One first line. Optional.' },
        body: { type: 'string', description: 'The tab text, blank lines between paragraphs. Empty (with empty lead) removes the tab.' },
      },
      required: ['title', 'body'],
    },
  },
];

/** True when `name` is one of the SPACE_PAGE_TOOLS. */
export function isSpacePageTool(name: string): boolean {
  return name.startsWith('set_space_') || name.startsWith('move_space_');
}

/** Execute one space page tool against the given space. Callers must have
 *  already verified the sender may edit this space (steward + space AI on +
 *  their own assistant_can_edit) — this function only does the work. */
export async function runSpacePageTool(
  sb: SbFn, spaceId: string, spaceName: string,
  name: string, input: Record<string, string & string[]>,
): Promise<SpaceToolOutcome> {
  const readSpacePage = async () => {
    const cur = await (await sb(`spaces?id=eq.${spaceId}&select=page,contact,description`)).json();
    const r = Array.isArray(cur) ? cur[0] : null;
    return {
      page: (r?.page ?? {}) as Record<string, unknown>,
      contact: (r?.contact ?? {}) as Record<string, string>,
      description: (r?.description ?? null) as string | null,
    };
  };
  const patchSpace = (body: Record<string, unknown>) =>
    sb(`spaces?id=eq.${spaceId}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(body),
    });

  if (name === 'get_space_page') {
    const { page, contact, description } = await readSpacePage();
    // No `change` key: a read is not an edit, and the calling surfaces use
    // `change` to tell the steward what was done to their page.
    return { ok: true, name: spaceName, description, contact, page };
  }

  if (name === 'set_space_tagline' || name === 'set_space_home_summary' || name === 'set_space_story') {
    const key = name === 'set_space_tagline' ? 'tagline' : name === 'set_space_home_summary' ? 'homeSummary' : 'story';
    const next = String(input[name === 'set_space_tagline' ? 'tagline' : name === 'set_space_home_summary' ? 'summary' : 'story'] ?? '').trim();
    if (key === 'tagline' && next.length > SPACE_TAGLINE_MAX) {
      return { ok: false, error: `A tagline is at most ${SPACE_TAGLINE_MAX} characters; that one is ${next.length}. Shorten it and try again.` };
    }
    const { page } = await readSpacePage();
    const previous = (page[key] as string | undefined) ?? null;
    const label = key === 'tagline' ? 'tagline' : key === 'homeSummary' ? 'home welcome' : 'story';
    if (!next) {
      if (previous === null || previous === undefined) {
        return { ok: false, error: `${spaceName}'s ${label} is already empty — nothing to clear.` };
      }
      delete page[key];
      await patchSpace({ page });
      return { ok: true, previous, change: `cleared ${spaceName}'s ${label}` };
    }
    page[key] = next;
    if (key === 'story' && !((page.tabs as unknown[] | undefined)?.length)) {
      page.tabs = [{ id: 'about' }, { id: 'services' }];
    }
    await patchSpace({ page });
    return {
      ok: true, previous,
      change: previous ? `rewrote ${spaceName}'s ${label}` : `wrote ${spaceName}'s ${label} (it was empty)`,
      note: previous ? 'Tell them what it said before, so they can ask for it back.' : undefined,
    };
  }

  if (name === 'set_space_description') {
    const next = String(input.description ?? '').trim();
    const { description: previous } = await readSpacePage();
    if (!next && !previous) return { ok: false, error: `${spaceName}'s description is already empty — nothing to clear.` };
    await patchSpace({ description: next || null });
    return {
      ok: true, previous,
      change: next
        ? (previous ? `rewrote ${spaceName}'s description` : `wrote ${spaceName}'s description (it was empty)`)
        : `cleared ${spaceName}'s description`,
    };
  }

  if (name === 'set_space_contact_field') {
    const field = String(input.field ?? '');
    if (!SPACE_CONTACT_FIELDS.includes(field)) {
      return { ok: false, error: `"${field}" is not a public contact field. Choose one of: ${SPACE_CONTACT_FIELDS.join(', ')}.` };
    }
    const value = String(input.value ?? '').trim();
    const { contact } = await readSpacePage();
    const previous = contact[field] ?? null;
    if (value) contact[field] = value; else delete contact[field];
    await patchSpace({ contact: Object.keys(contact).length ? contact : null });
    return {
      ok: true, previous,
      change: value ? `set ${spaceName}'s public ${field} to ${value}` : `cleared ${spaceName}'s public ${field}`,
    };
  }

  if (name === 'move_space_section_photo' || name === 'move_space_photo_to_home_cover') {
    const fromSection = String(input.from_section ?? '');
    const toSection = name === 'move_space_photo_to_home_cover' ? null : String(input.to_section ?? '');
    const { page } = await readSpacePage();
    const sections = (page.sections ?? {}) as Record<string, { lead?: string; image?: string; imagePos?: string; imageSize?: string } | undefined>;
    const fromData = sections[fromSection];
    if (!fromData?.image) return { ok: false, error: `No photo on the ${fromSection} tab to move.` };
    const photo = fromData.image;
    const imagePos = fromData.imagePos;
    delete sections[fromSection]?.image;
    if (sections[fromSection]) { delete sections[fromSection]!.imagePos; delete sections[fromSection]!.imageSize; }
    if (toSection === null) {
      page.cover = photo; page.coverStyle = 'photo'; page.coverPos = 50;
    } else if (toSection) {
      sections[toSection] = { ...sections[toSection], image: photo, imagePos };
    }
    page.sections = sections;
    await patchSpace({ page });
    return {
      ok: true,
      change: toSection === null
        ? `moved the photo from ${fromSection} to be ${spaceName}'s Home cover`
        : toSection
          ? `moved the photo from ${fromSection} to ${toSection} on ${spaceName}'s page`
          : `removed the photo from ${fromSection} on ${spaceName}'s page`,
    };
  }

  if (name === 'set_space_section_photo_position') {
    const sectionId = String(input.section ?? '');
    const raw = String(input.position ?? '').trim();
    const pct = raw === 'top' ? 0 : raw === 'center' ? 50 : raw === 'bottom' ? 100 : Number(raw);
    if (!(pct >= 0 && pct <= 100)) return { ok: false, error: 'position must be top, center, bottom, or a number 0–100.' };
    const { page } = await readSpacePage();
    const sections = (page.sections ?? {}) as Record<string, { lead?: string; image?: string; imagePos?: string } | undefined>;
    if (!sections[sectionId]?.image) return { ok: false, error: `No photo on the ${sectionId} tab to adjust.` };
    const previous = sections[sectionId]!.imagePos ?? 'center';
    sections[sectionId]!.imagePos = `50% ${Math.round(pct)}%`;
    page.sections = sections;
    await patchSpace({ page });
    return { ok: true, previous, change: `set the ${sectionId} photo to show from ${Math.round(pct)}% down (0 = top)` };
  }

  if (name === 'set_space_page_tab') {
    const title = String(input.title ?? '').trim().slice(0, 60);
    if (!title) return { ok: false, error: 'A tab needs a name.' };
    const lead = String(input.lead ?? '').trim();
    const bodyText = String(input.body ?? '').trim();
    const BUILT_IN = ['about', 'services', 'goods', 'contact', 'gallery'];
    const { page } = await readSpacePage();
    const tabs = (Array.isArray(page.tabs) ? page.tabs : []) as { id: string; label?: string; lead?: string; body?: string }[];
    const norm = (x: string) => x.toLowerCase().trim();
    const hit = tabs.find((t) => norm(t.label ?? '') === norm(title) || norm(t.id) === norm(title));
    if (hit && BUILT_IN.includes(hit.id)) {
      return { ok: false, error: `"${title}" is a built-in tab — it fills itself and cannot be written or removed here.` };
    }
    if (!bodyText && !lead) {
      if (!hit) return { ok: false, error: `No tab named "${title}" to remove.` };
      page.tabs = tabs.filter((t) => t !== hit);
      await patchSpace({ page });
      return { ok: true, previous: hit.body ?? null, change: `removed the "${hit.label ?? hit.id}" tab from ${spaceName}'s page` };
    }
    if (hit) {
      const previous = { lead: hit.lead ?? null, body: hit.body ?? null };
      hit.label = title; hit.lead = lead || undefined; hit.body = bodyText || undefined;
      await patchSpace({ page });
      return { ok: true, previous, change: `rewrote the "${title}" tab on ${spaceName}'s page`, note: 'Tell them what it said before if it held anything.' };
    }
    const id = 'custom-' + Math.random().toString(36).slice(2, 8);
    page.tabs = [...tabs, { id, label: title, lead: lead || undefined, body: bodyText || undefined }];
    await patchSpace({ page });
    return { ok: true, previous: null, change: `created the "${title}" tab on ${spaceName}'s page` };
  }

  return { ok: false, error: `No such space tool: ${name}` };
}
