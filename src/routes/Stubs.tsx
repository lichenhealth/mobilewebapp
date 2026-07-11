import Placeholder from './Placeholder';

export function Saved() {
  return (
    <Placeholder
      title="Saved"
      icon="saved"
      intro="Things you wanted to come back to. Organized by quiet folders, not algorithms."
      hint="Coming in pass two"
    />
  );
}

// Maps graduated to a real screen (src/routes/MapView.tsx, 2026-07-05).

export function Profile() {
  return (
    <Placeholder
      title="Profile"
      icon="profile"
      intro="The version of you that lives here. Editable. Quiet. Yours."
      hint="Coming in pass two"
    />
  );
}
