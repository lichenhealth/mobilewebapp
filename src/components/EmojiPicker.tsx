import { useMemo, useState } from 'react';
import './EmojiPicker.css';

/** Curated, dependency-free emoji palette — searchable since 2026-08-31
 *  (founder: "a search feature for the chat emojis, and add some more").
 *  Every emoji carries its own hand-written keywords, so search works with
 *  no index library and no CDN data; the set stays deliberately finite. */
type E = [emoji: string, keywords: string];

const CATEGORIES: { label: string; emoji: E[] }[] = [
  {
    label: 'Smileys',
    emoji: [
      ['😀', 'grin happy smile'], ['😃', 'smile happy joy'], ['😄', 'smile happy laugh'],
      ['😁', 'grin beam teeth'], ['😆', 'laugh haha squint'], ['😅', 'sweat laugh relief'],
      ['😂', 'joy laugh tears funny lol'], ['🤣', 'rofl laugh rolling funny'],
      ['🥲', 'smile tear bittersweet grateful'], ['😊', 'blush smile warm happy'],
      ['😇', 'halo angel innocent'], ['🙂', 'slight smile ok'], ['😉', 'wink flirt'],
      ['😌', 'relieved calm peaceful'], ['😍', 'heart eyes love adore'],
      ['🥰', 'love hearts adore smitten'], ['😘', 'kiss blow love'], ['😋', 'yum tasty delicious'],
      ['😛', 'tongue playful'], ['😜', 'wink tongue silly'], ['🤪', 'zany wild crazy silly'],
      ['🤗', 'hug open arms welcome'], ['🤭', 'giggle oops hand mouth'], ['🤫', 'shush quiet secret'],
      ['🤔', 'thinking hmm consider'], ['🤨', 'raised eyebrow skeptical suspicious'],
      ['😐', 'neutral meh blank'], ['😶', 'speechless no words silent'],
      ['🙄', 'eye roll whatever'], ['😏', 'smirk sly'], ['😴', 'sleep zzz tired'],
      ['🥱', 'yawn tired bored'], ['😮', 'wow open mouth surprised'], ['😲', 'astonished shocked'],
      ['🥳', 'party celebrate birthday hat'], ['😎', 'cool sunglasses'],
      ['🤓', 'nerd glasses geek'], ['🧐', 'monocle inspect curious'],
      ['😳', 'flushed embarrassed blush shocked'], ['🥺', 'pleading puppy eyes please cute'],
      ['😢', 'cry sad tear'], ['😭', 'sob cry loud tears sad'], ['😤', 'huff frustrated steam determined'],
      ['😱', 'scream fear shocked'], ['😖', 'confounded frustrated'], ['😞', 'disappointed sad'],
      ['😓', 'downcast sweat sad tired'], ['🙃', 'upside down silly ironic'],
      ['🫠', 'melting hot embarrassed dissolve'], ['🤠', 'cowboy hat yeehaw'],
      ['😡', 'angry mad red rage'], ['🤬', 'cursing swearing furious'],
      ['😠', 'angry mad annoyed'], ['🥴', 'woozy dizzy drunk'],
      ['🤒', 'sick thermometer fever ill'], ['🤕', 'hurt bandage injured'],
      ['🤧', 'sneeze sick tissue'], ['😷', 'mask sick health'],
      ['🤢', 'nauseous sick green'], ['🤮', 'vomit sick gross'],
      ['🥶', 'cold freezing frozen'], ['🥵', 'hot heat sweating'],
      ['🤥', 'lying pinocchio nose'], ['🤐', 'zipper lips sealed secret'],
      ['😬', 'grimace awkward yikes'], ['🫣', 'peeking hide shy'],
      ['🫡', 'salute respect yes sir'], ['🤯', 'mind blown exploding head wow'],
      ['😈', 'devil mischief evil purple'], ['👻', 'ghost boo spooky halloween'],
      ['💀', 'skull dead dying funny'], ['👽', 'alien ufo space'],
      ['🤖', 'robot bot ai'], ['🎃', 'pumpkin halloween jack'],
      ['😺', 'cat smile happy'], ['😻', 'cat heart eyes love'], ['🙀', 'cat shocked wow'],
    ],
  },
  {
    label: 'People',
    emoji: [
      ['👍', 'thumbs up yes good like approve'], ['👎', 'thumbs down no bad dislike'],
      ['👌', 'ok perfect fine'], ['✌️', 'peace victory two'], ['🤞', 'fingers crossed luck hope'],
      ['🤟', 'love you sign'], ['🤘', 'rock horns metal'], ['🤙', 'call me hang loose shaka'],
      ['👈', 'point left'], ['👉', 'point right'], ['👆', 'point up'], ['👇', 'point down'],
      ['✋', 'hand stop high five'], ['🖖', 'vulcan spock live long'],
      ['👋', 'wave hello goodbye hi bye'], ['🤝', 'handshake deal agree partnership'],
      ['🙏', 'pray thanks please gratitude namaste'], ['🫶', 'heart hands love care'],
      ['👏', 'clap applause bravo'], ['🙌', 'raised hands celebrate praise hooray'],
      ['🤲', 'open palms offer receive giving'], ['💪', 'muscle strong flex strength'],
      ['👀', 'eyes look watching see'], ['🧠', 'brain smart mind think'],
      ['🙋', 'raise hand volunteer me question'], ['🤷', 'shrug dunno whatever'],
      ['🤦', 'facepalm doh oops'], ['💁', 'sassy information tipping hand'],
      ['🙆', 'ok arms yes'], ['🙅', 'no arms crossed nope'],
      ['🧘', 'meditate yoga lotus calm zen mindfulness'], ['🚶', 'walk walking stroll'],
      ['🏃', 'run running exercise'], ['💃', 'dance dancer woman salsa'],
      ['🕺', 'dance dancer man disco'], ['🤸', 'cartwheel gymnastics'],
      ['👶', 'baby infant'], ['🧒', 'child kid'], ['🧓', 'older elder grandparent'],
      ['👥', 'people group silhouette community'],
      ['🧑‍🌾', 'farmer garden grow agriculture'], ['🧑‍🍳', 'chef cook kitchen'],
      ['🧑‍⚕️', 'doctor nurse health care medic'], ['🧑‍🏫', 'teacher educator school'],
      ['🧑‍🎨', 'artist painter creative'], ['🧑‍🔧', 'mechanic fix repair'],
      ['👨‍👩‍👧‍👦', 'family parents kids'], ['🫂', 'hug embrace comfort support'],
      ['🦶', 'foot step'], ['🦻', 'ear hearing listen'], ['🗣️', 'speaking talk voice'],
      ['👣', 'footprints steps path'],
    ],
  },
  {
    label: 'Hearts & symbols',
    emoji: [
      ['❤️', 'red heart love'], ['🧡', 'orange heart'], ['💛', 'yellow heart friendship'],
      ['💚', 'green heart nature'], ['💙', 'blue heart'], ['💜', 'purple heart'],
      ['🖤', 'black heart'], ['🤍', 'white heart pure'], ['🤎', 'brown heart'],
      ['💕', 'two hearts love'], ['💞', 'revolving hearts love'], ['💓', 'beating heart pulse'],
      ['💗', 'growing heart love'], ['💖', 'sparkling heart love'], ['💘', 'heart arrow cupid'],
      ['💝', 'heart ribbon gift'], ['❣️', 'heart exclamation'], ['💔', 'broken heart sad breakup'],
      ['❤️‍🔥', 'heart fire passion burning'], ['❤️‍🩹', 'mending heart healing recover'],
      ['💯', 'hundred percent perfect score'], ['✨', 'sparkles magic shiny new'],
      ['⭐', 'star favorite'], ['🌟', 'glowing star shine'], ['💫', 'dizzy star swirl'],
      ['⚡', 'lightning bolt zap energy'], ['🔥', 'fire hot flame lit'],
      ['🎉', 'party popper celebrate congratulations tada'], ['🎊', 'confetti celebrate'],
      ['🎈', 'balloon party birthday'], ['🎁', 'gift present wrapped'],
      ['🏆', 'trophy winner champion award'], ['🥇', 'gold medal first winner'],
      ['✅', 'check yes done complete'], ['❌', 'x no wrong cancel'],
      ['❓', 'question mark'], ['❗', 'exclamation important'],
      ['💤', 'zzz sleep snore'], ['💬', 'speech bubble chat message'],
      ['💭', 'thought bubble thinking'], ['♾️', 'infinity forever'],
      ['🔆', 'brightness sun dim'], ['☮️', 'peace sign'],
      ['☯️', 'yin yang balance tao harmony'], ['🕉️', 'om aum hindu sacred'],
      ['🪷', 'lotus flower spiritual purity bloom'], ['🧿', 'evil eye nazar protection amulet'],
      ['📿', 'prayer beads mala meditation'], ['🕊️', 'dove peace bird hope'],
      ['♻️', 'recycle sustainable green'], ['⚕️', 'medical caduceus health'],
      ['🔔', 'bell notification ring'], ['🎵', 'music note song'], ['🎶', 'music notes melody'],
      ['➕', 'plus add'], ['➖', 'minus subtract'], ['🆗', 'ok okay'],
      ['🔴', 'red circle dot'], ['🟢', 'green circle dot go'], ['🌀', 'spiral cyclone swirl'],
    ],
  },
  {
    label: 'Nature',
    emoji: [
      ['🌱', 'seedling sprout grow new plant'], ['🌿', 'herb leaves plant'],
      ['☘️', 'shamrock clover'], ['🍀', 'four leaf clover luck lucky'],
      ['🍃', 'leaf wind blowing nature'], ['🌵', 'cactus desert'],
      ['🌲', 'evergreen pine tree forest'], ['🌳', 'tree deciduous forest'],
      ['🌴', 'palm tree tropical beach'], ['🌾', 'wheat grain rice sheaf harvest'],
      ['🌻', 'sunflower yellow'], ['🌼', 'blossom daisy flower'],
      ['🌸', 'cherry blossom pink spring sakura'], ['🌺', 'hibiscus flower tropical'],
      ['🌹', 'rose flower red romance'], ['🌷', 'tulip flower spring'],
      ['💐', 'bouquet flowers gift'], ['🍄', 'mushroom fungus toadstool'],
      ['🪴', 'potted plant houseplant'], ['🌰', 'chestnut acorn nut'],
      ['🍂', 'fallen leaves autumn fall'], ['🍁', 'maple leaf autumn canada'],
      ['🪵', 'wood log lumber'], ['🪨', 'rock stone'], ['🌚', 'new moon face'],
    ],
  },
  {
    label: 'Animals',
    emoji: [
      ['🐝', 'bee honeybee buzz'], ['🦋', 'butterfly transform'], ['🐞', 'ladybug beetle'],
      ['🐢', 'turtle tortoise slow'], ['🐸', 'frog toad'], ['🐌', 'snail slow'],
      ['🐚', 'shell seashell beach'], ['🐶', 'dog puppy pet'], ['🐱', 'cat kitten pet'],
      ['🐰', 'rabbit bunny'], ['🦊', 'fox clever'], ['🐻', 'bear'],
      ['🐼', 'panda'], ['🐨', 'koala'], ['🦁', 'lion king'], ['🐮', 'cow cattle'],
      ['🐷', 'pig'], ['🐴', 'horse pony riding barn equine'], ['🐎', 'horse galloping racing equine'],
      ['🦄', 'unicorn magic'], ['🐔', 'chicken hen rooster'], ['🐣', 'chick hatching baby bird'],
      ['🐧', 'penguin'], ['🦉', 'owl wise night'], ['🦅', 'eagle bird'],
      ['🦆', 'duck'], ['🕊️', 'dove peace pigeon'], ['🦜', 'parrot bird tropical'],
      ['🦩', 'flamingo pink'], ['🐍', 'snake serpent'], ['🦎', 'lizard gecko'],
      ['🐊', 'crocodile alligator'], ['🐟', 'fish'], ['🐠', 'tropical fish reef'],
      ['🐬', 'dolphin'], ['🐳', 'whale spouting'], ['🦈', 'shark'], ['🦭', 'seal sea lion'],
      ['🐙', 'octopus'], ['🦀', 'crab'], ['🐺', 'wolf'], ['🦌', 'deer elk stag'],
      ['🐐', 'goat'], ['🐑', 'sheep lamb wool'], ['🦙', 'llama alpaca'],
      ['🐿️', 'squirrel chipmunk'], ['🦔', 'hedgehog'], ['🦇', 'bat night'],
      ['🐘', 'elephant'], ['🦒', 'giraffe'], ['🐒', 'monkey'], ['🦥', 'sloth slow rest'],
      ['🐾', 'paw prints tracks animal'],
    ],
  },
  {
    label: 'Earth & sky',
    emoji: [
      ['🌊', 'wave ocean water sea'], ['⛰️', 'mountain peak'], ['🏔️', 'snow mountain summit'],
      ['🌋', 'volcano eruption'], ['🏜️', 'desert dunes'], ['🏞️', 'national park river valley'],
      ['🏕️', 'camping tent outdoors'], ['🏖️', 'beach umbrella sand'],
      ['🌅', 'sunrise dawn morning'], ['🌄', 'sunrise mountains morning'],
      ['🌇', 'sunset dusk city'], ['🌈', 'rainbow pride hope'],
      ['☀️', 'sun sunny bright'], ['⛅', 'partly cloudy sun cloud'],
      ['☁️', 'cloud cloudy'], ['🌧️', 'rain shower'], ['⛈️', 'thunderstorm lightning storm'],
      ['❄️', 'snowflake snow winter cold'], ['⛄', 'snowman winter'],
      ['🌫️', 'fog mist'], ['🌬️', 'wind blowing breeze'],
      ['🌙', 'crescent moon night'], ['🌕', 'full moon'], ['🌑', 'new moon dark'],
      ['🪐', 'saturn planet rings space'], ['🌍', 'earth globe world planet'],
      ['🌠', 'shooting star wish'], ['☄️', 'comet space'],
    ],
  },
  {
    label: 'Food & drink',
    emoji: [
      ['🍎', 'apple red fruit'], ['🍊', 'orange tangerine fruit'], ['🍋', 'lemon sour'],
      ['🍌', 'banana'], ['🍉', 'watermelon'], ['🍇', 'grapes'], ['🍓', 'strawberry'],
      ['🫐', 'blueberries'], ['🍒', 'cherries'], ['🍑', 'peach'], ['🥭', 'mango'],
      ['🍍', 'pineapple'], ['🥥', 'coconut'], ['🥝', 'kiwi'], ['🍅', 'tomato'],
      ['🥑', 'avocado'], ['🥦', 'broccoli'], ['🥬', 'leafy greens lettuce kale'],
      ['🥒', 'cucumber pickle'], ['🌶️', 'hot pepper chili spicy'], ['🥕', 'carrot'],
      ['🧄', 'garlic'], ['🥔', 'potato'], ['🎃', 'pumpkin squash'],
      ['🥐', 'croissant pastry'], ['🍞', 'bread loaf'], ['🥖', 'baguette bread'],
      ['🧀', 'cheese'], ['🥚', 'egg'], ['🍳', 'fried egg cooking breakfast'],
      ['🥞', 'pancakes breakfast'], ['🧇', 'waffle breakfast'], ['🥓', 'bacon'],
      ['🍗', 'chicken drumstick'], ['🥩', 'steak meat'], ['🍔', 'hamburger burger'],
      ['🍟', 'fries chips'], ['🍕', 'pizza slice'], ['🌭', 'hot dog'],
      ['🥪', 'sandwich'], ['🌮', 'taco'], ['🌯', 'burrito wrap'], ['🥗', 'salad healthy'],
      ['🍝', 'spaghetti pasta'], ['🍜', 'ramen noodles soup'], ['🍲', 'stew pot soup'],
      ['🍣', 'sushi'], ['🥟', 'dumpling potsticker'], ['🍚', 'rice bowl'],
      ['🍛', 'curry rice'], ['🍧', 'shaved ice dessert'], ['🍦', 'ice cream soft serve'],
      ['🧁', 'cupcake'], ['🍰', 'cake slice shortcake'], ['🎂', 'birthday cake celebrate'],
      ['🍩', 'donut doughnut'], ['🍭', 'lollipop candy'], ['🍫', 'chocolate bar'],
      ['🍿', 'popcorn movie'], ['🍪', 'cookie'], ['🍯', 'honey pot'],
      ['☕', 'coffee hot drink tea cup'], ['🍵', 'tea green matcha'], ['🫖', 'teapot tea'],
      ['🧃', 'juice box'], ['🥤', 'cup straw soda smoothie'], ['🥛', 'milk glass'],
      ['🥂', 'champagne cheers toast celebrate'], ['🍷', 'wine glass'], ['🍺', 'beer mug'],
      ['🍾', 'champagne bottle pop celebrate'], ['🧉', 'mate tea'],
    ],
  },
  {
    label: 'Activity & travel',
    emoji: [
      ['⚽', 'soccer football'], ['🏀', 'basketball'], ['🏈', 'football american'],
      ['⚾', 'baseball'], ['🎾', 'tennis'], ['🏐', 'volleyball'], ['🎱', 'pool billiards eight ball'],
      ['🏓', 'ping pong table tennis'], ['🏸', 'badminton'], ['⛳', 'golf flag hole'],
      ['🏹', 'archery bow arrow'], ['🎣', 'fishing pole'], ['🥊', 'boxing gloves'],
      ['🎽', 'running shirt race'], ['🎿', 'ski skiing'], ['🏂', 'snowboard'],
      ['🏋️', 'weightlifting gym lifting'], ['🤺', 'fencing sword'], ['🏇', 'horse racing jockey'],
      ['🧗', 'climbing rock climb'], ['🚴', 'cycling bike bicycle'],
      ['🏊', 'swimming swim'], ['🚣', 'rowing boat'], ['🧜', 'mermaid'],
      ['🎪', 'circus tent'], ['🎨', 'art palette paint creative'], ['🎭', 'theater masks drama'],
      ['🎬', 'clapper movie film'], ['🎤', 'microphone sing karaoke'],
      ['🎧', 'headphones music listen'], ['🎼', 'sheet music score'],
      ['🎹', 'piano keyboard keys'], ['🥁', 'drum drums'], ['🎷', 'saxophone jazz'],
      ['🎺', 'trumpet'], ['🎸', 'guitar rock'], ['🪕', 'banjo folk'], ['🎻', 'violin fiddle'],
      ['🎲', 'dice game chance'], ['♟️', 'chess pawn strategy'], ['🎯', 'target bullseye darts'],
      ['🎳', 'bowling'], ['🎮', 'video game controller gaming'], ['🧩', 'puzzle piece jigsaw'],
      ['🪁', 'kite wind'], ['🛹', 'skateboard'], ['🛼', 'roller skate'],
      ['🚗', 'car automobile drive'], ['🚙', 'suv jeep car'], ['🚌', 'bus'],
      ['🚂', 'train locomotive steam'], ['🚲', 'bicycle bike'], ['🛵', 'scooter moped vespa'],
      ['🚜', 'tractor farm'], ['🛻', 'pickup truck'], ['✈️', 'airplane flight travel'],
      ['🚀', 'rocket launch space ship'], ['🛶', 'canoe paddle'], ['⛵', 'sailboat sailing'],
      ['🚁', 'helicopter'], ['🏠', 'house home'], ['🏡', 'house garden home'],
      ['🏚️', 'old house derelict'], ['🏥', 'hospital health'], ['🏫', 'school'],
      ['⛪', 'church chapel'], ['🕌', 'mosque'], ['🛕', 'temple hindu'],
      ['⛩️', 'shrine torii gate'], ['⛺', 'tent camping'], ['🗺️', 'map world travel'],
      ['🧭', 'compass direction navigate'], ['🎡', 'ferris wheel fair'],
      ['🎢', 'roller coaster'], ['🌉', 'bridge night'], ['🗽', 'statue liberty new york'],
    ],
  },
  {
    label: 'Objects',
    emoji: [
      ['📱', 'phone mobile smartphone'], ['💻', 'laptop computer'], ['⌚', 'watch time'],
      ['📷', 'camera photo'], ['🎥', 'movie camera film'], ['🔍', 'magnifying glass search find'],
      ['💡', 'light bulb idea'], ['🕯️', 'candle light presence'], ['🔦', 'flashlight torch'],
      ['🏮', 'lantern red paper'], ['📖', 'open book reading'], ['📚', 'books stack library study'],
      ['📓', 'notebook journal'], ['✏️', 'pencil write'], ['🖊️', 'pen write'],
      ['📝', 'memo note writing'], ['📌', 'pushpin pin'], ['📎', 'paperclip attach'],
      ['🔑', 'key unlock'], ['🗝️', 'old key antique'], ['🔨', 'hammer build tool'],
      ['🪚', 'saw carpentry wood'], ['🔧', 'wrench fix tool'], ['🪛', 'screwdriver tool'],
      ['⚙️', 'gear settings cog'], ['🧰', 'toolbox tools'], ['🧲', 'magnet attract'],
      ['🧪', 'test tube science experiment'], ['🧬', 'dna genetics biology'],
      ['🔭', 'telescope stars astronomy'], ['🔬', 'microscope science lab'],
      ['💊', 'pill medicine capsule'], ['🩹', 'bandage band aid heal'],
      ['🩺', 'stethoscope doctor checkup'], ['🌡️', 'thermometer temperature fever'],
      ['🧺', 'basket laundry picnic'], ['🛁', 'bathtub bath soak'],
      ['🧼', 'soap clean wash'], ['🧴', 'lotion bottle skincare'],
      ['🖼️', 'framed picture art'], ['🛍️', 'shopping bags'], ['🎀', 'ribbon bow'],
      ['📦', 'package box delivery'], ['✉️', 'envelope mail letter'],
      ['📅', 'calendar date schedule'], ['⏰', 'alarm clock time wake'],
      ['⌛', 'hourglass time waiting'], ['💰', 'money bag cash'], ['🪙', 'coin money'],
      ['💎', 'gem diamond jewel'], ['⚖️', 'scales balance justice'],
      ['🔒', 'lock locked private'], ['🔓', 'unlocked open'],
      ['🧵', 'thread sewing weave'], ['🧶', 'yarn knitting'], ['🪡', 'needle sewing'],
      ['🎓', 'graduation cap diploma'], ['👑', 'crown royal'], ['🕰️', 'mantel clock antique time'],
      ['📻', 'radio'], ['☎️', 'telephone old phone'], ['🖌️', 'paintbrush art'],
      ['🪄', 'magic wand spell'], ['🎟️', 'ticket admission'], ['🧳', 'luggage suitcase travel'],
    ],
  },
];

/** A small popover grid of emoji with a search box (matches on the
 *  hand-written keywords). The parent positions it (wrap it in a
 *  position:relative container) and decides when it's open. */
export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const hits = useMemo(() => {
    if (!query) return null;
    // Deduped: a few emoji live in two categories (the dove, the pumpkin) —
    // a repeat in one flat result grid would double both the row and the key.
    const seen = new Set<string>();
    const out: E[] = [];
    for (const c of CATEGORIES) {
      for (const e of c.emoji) {
        if (seen.has(e[0])) continue;
        if (e[1].includes(query) || c.label.toLowerCase().includes(query)) {
          seen.add(e[0]);
          out.push(e);
        }
        if (out.length >= 64) return out;
      }
    }
    return out;
  }, [query]);

  const grid = (list: E[]) => (
    <div className="emoji-pop__grid">
      {list.map(([e, kw]) => (
        <button
          key={e}
          type="button"
          className="emoji-pop__btn"
          onClick={() => onPick(e)}
          title={kw.split(' ').slice(0, 3).join(' ')}
          aria-label={`Insert ${kw.split(' ')[0]} emoji`}
        >
          {e}
        </button>
      ))}
    </div>
  );

  return (
    <div className="emoji-pop">
      <div className="emoji-pop__search">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search emojis…"
          aria-label="Search emojis"
        />
        {q && (
          <button type="button" onClick={() => setQ('')} aria-label="Clear search">×</button>
        )}
      </div>
      {hits ? (
        hits.length ? grid(hits) : <p className="emoji-pop__none">Nothing matches “{q.trim()}”.</p>
      ) : (
        CATEGORIES.map((c) => (
          <div key={c.label} className="emoji-pop__section">
            <p className="emoji-pop__label">{c.label}</p>
            {grid(c.emoji)}
          </div>
        ))
      )}
    </div>
  );
}
