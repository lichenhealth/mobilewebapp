-- Drive presentations (founder 2026-11-14: "build that feature into drive
-- with the + like google drive and then claude brain can build me my
-- spreadsheet as i desire"). A presentation is a chat_docs row of kind
-- 'slides' — data.slides = [{title, body}] — personal (chat_id null) or a
-- room's, riding every existing policy and trigger unchanged.
alter table public.chat_docs drop constraint if exists chat_docs_kind_check;
alter table public.chat_docs add constraint chat_docs_kind_check
  check (kind = any (array['doc','poll','sheet','slides']));
