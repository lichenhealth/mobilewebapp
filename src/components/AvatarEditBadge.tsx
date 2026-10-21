import { useRef } from 'react';
import { Icon } from './Icon';
import './AvatarEditBadge.css';

/** The photo badge a hero avatar wears for whoever may change it (founder
 *  2026-10-21: "edit the profile picture as the admin with a '+' … in every
 *  view. Once I've added one, maybe a triangle (e.g. change) … so I don't
 *  have to navigate to the profile page to change the pic. Same goes for my
 *  pic anywhere on the network"). A peach "+" invites when the slot is
 *  empty; once a photo exists a quiet image mark reads "change". The badge
 *  carries its own hidden file input, so a caller only handles the file.
 *  Never rendered to anyone who can't write the photo — the caller gates. */
export function AvatarEditBadge({
  hasPhoto, busy, subjectName, onFile,
}: {
  hasPhoto: boolean;
  busy?: boolean;
  /** For the accessible label: "Change Countryman Stables' photo". */
  subjectName: string;
  onFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        className={'ava-edit' + (hasPhoto ? '' : ' ava-edit--add')}
        onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
        disabled={busy}
        aria-label={hasPhoto ? `Change ${subjectName}'s photo` : `Add a photo for ${subjectName}`}
        title={hasPhoto ? 'Change the photo' : 'Add a photo'}
      >
        {busy ? <span className="ava-edit__busy" aria-hidden="true">…</span>
          : <Icon name={hasPhoto ? 'image' : 'plus'} size={13} />}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </>
  );
}
