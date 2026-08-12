-- Alpha-data cleanup (founder 2026-08-11: "let's clean that up"): two
-- spaces named 'The Audacity Lab'. The real one is ecea7fdd (Steve Dobo,
-- 2026-07-26 — 2 members incl. Glenna, a post, a 7-message chat, map pin,
-- description). The duplicate dcfcea36 (Glenna Norvelle, 2026-07-27) holds
-- nothing but its own creation artifacts — she created it the same day she
-- joined the real one, almost certainly by accident.

delete from chat_members
  where chat_id in (select id from chats where space_id = 'dcfcea36-af98-4c00-b947-9922954fc5ca');
delete from chats where space_id = 'dcfcea36-af98-4c00-b947-9922954fc5ca';
delete from space_members where space_id = 'dcfcea36-af98-4c00-b947-9922954fc5ca';
delete from spaces where id = 'dcfcea36-af98-4c00-b947-9922954fc5ca';
