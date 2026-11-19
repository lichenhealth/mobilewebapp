-- The BEFORE DELETE lift trigger (20261119160000) broke any delete that
-- removes a folder AND the folders inside it in one statement (a space's or
-- account's deletion, or a bulk delete): Postgres refuses to delete a row the
-- trigger just updated. Drop it. The FK's ON DELETE SET NULL is the safety
-- net (an orphaned sub-folder lands at the top), and the app's own delete
-- doors lift sub-folders to the grandparent BEFORE deleting.
drop trigger if exists collections_lift_children on public.collections;
drop function if exists public.collections_lift_children();
