import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { uploadPageImage } from '../lib/avatarApi';
import { Icon } from './Icon';
import './CoverPicker.css';

/** The cover photo behind "Photo cover" (founder 2026-08-11: "it should
 *  prompt you to upload one, or look at the gallery of photos you've
 *  already uploaded to lichen"). Upload goes through the same
 *  uploadPageImage path as the page gallery; the picker grid harvests
 *  what's already here — the page's own gallery photos plus photos from
 *  this member's (or space's) posts (`image_url` + `details.media`). */

const GALLERY_CAP = 24;

export default function CoverPicker({ value, onChange, uploaderId, authorId, spaceId, extraPhotos = [] }: {
  /** page.cover — the chosen photo's URL. */
  value?: string;
  onChange: (cover?: string) => void;
  /** Whose storage folder uploads land in (the signed-in member). */
  uploaderId: string;
  /** Harvest post photos by member… */
  authorId?: string;
  /** …or by space (its wall — posted as it or to it). */
  spaceId?: string;
  /** The page's own gallery uploads (page.photos) lead the grid. */
  extraPhotos?: string[];
}) {
  const [postPhotos, setPostPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    (async () => {
      let q = supabase.from('posts').select('image_url, details').order('created_at', { ascending: false }).limit(40);
      if (spaceId) q = q.or(`author_space_id.eq.${spaceId},space_id.eq.${spaceId}`);
      else if (authorId) q = q.eq('author_id', authorId);
      else return;
      const { data } = await q;
      if (!live) return;
      const urls: string[] = [];
      ((data as { image_url: string | null; details: Record<string, unknown> | null }[] | null) ?? []).forEach((p) => {
        if (p.image_url) urls.push(p.image_url);
        const media = Array.isArray(p.details?.media) ? (p.details.media as { type: string; url: string }[]) : [];
        media.forEach((m) => { if (m.type === 'photo' && m.url) urls.push(m.url); });
      });
      setPostPhotos(urls);
    })();
    return () => { live = false; };
  }, [authorId, spaceId]);

  const gallery = [...new Set([...extraPhotos, ...postPhotos])].slice(0, GALLERY_CAP);

  async function onFile(file?: File) {
    if (!file) return;
    setBusy(true); setError('');
    try { onChange(await uploadPageImage(uploaderId, file)); }
    catch (e) { setError((e as Error)?.message || 'Upload failed.'); }
    setBusy(false);
  }

  return (
    <div className="coverp">
      {value && (
        <div className="coverp__current">
          <img src={value} alt="Your cover photo" />
          <button className="coverp__remove" onClick={() => onChange(undefined)} aria-label="Remove cover photo">
            <Icon name="close" size={12} />
          </button>
        </div>
      )}
      <label className="btn coverp__upload">
        {busy ? 'Uploading…' : value ? 'Upload a different photo' : 'Upload a photo'}
        <input
          type="file" accept="image/*" hidden disabled={busy}
          onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }}
        />
      </label>
      {gallery.length > 0 && (
        <>
          <p className="prof__hint coverp__lead">…or pick one already on Lichen:</p>
          <div className="coverp__grid">
            {gallery.map((url) => (
              <button
                key={url}
                className={'coverp__thumb' + (url === value ? ' is-on' : '')}
                onClick={() => onChange(url)}
                aria-label="Use this photo as the cover"
              >
                <img src={url} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        </>
      )}
      {error && <p className="prof__error">{error}</p>}
    </div>
  );
}
