/**
 * The sticker library (R12.1 — «کتابخانه استیکر»): the full emoji catalog
 * behind the Sticker Picker dialog and the Inspector's sticker search.
 *
 * Pure data + pure logic — no React/DOM imports, node-testable (mirrors
 * `core/templates/templates.ts`): every entry carries one category and
 * bilingual (Persian + English) keywords so the SAME search serves both
 * UI languages. Search normalises the query (Persian/Arabic yeh-kaf
 * unification, ZWNJ → space, case/whitespace folding) so «كتاب» finds
 * «کتاب» and «می‌شود» finds «می شد».
 *
 * The curated quick palette (R11.1's 32 glyphs) lives here too — the
 * Inspector renders it when the search box is empty, and the library
 * search takes over the moment the user types.
 */

/** Identifier of one sticker category (i18n title keys ride on it). */
export type StickerCategoryId =
  | "smileys"
  | "gestures"
  | "hearts"
  | "animals"
  | "food"
  | "activities"
  | "travel"
  | "objects"
  | "symbols";

/** One sticker category (tab) of the picker. */
export interface StickerCategory {
  /** The category id (stable wire value). */
  readonly id: StickerCategoryId;
  /** i18n key of the category's display name. */
  readonly titleKey: string;
  /** The category's tab glyph (also rendered as the tab icon). */
  readonly emoji: string;
  /** Tab order (ascending). */
  readonly order: number;
}

/** One library entry: an emoji plus its category and search keywords. */
export interface StickerLibraryEntry {
  /** The emoji glyph (one grapheme cluster). */
  readonly emoji: string;
  /** The entry's category. */
  readonly category: StickerCategoryId;
  /** Bilingual search keywords (Persian + English). */
  readonly keywords: readonly string[];
}

/** The picker's category tabs, in render order. */
export const STICKER_CATEGORIES: readonly StickerCategory[] = [
  { id: "smileys", titleKey: "stickerLibrary.category.smileys", emoji: "😀", order: 10 },
  { id: "gestures", titleKey: "stickerLibrary.category.gestures", emoji: "👋", order: 20 },
  { id: "hearts", titleKey: "stickerLibrary.category.hearts", emoji: "❤️", order: 30 },
  { id: "animals", titleKey: "stickerLibrary.category.animals", emoji: "🐱", order: 40 },
  { id: "food", titleKey: "stickerLibrary.category.food", emoji: "🍕", order: 50 },
  { id: "activities", titleKey: "stickerLibrary.category.activities", emoji: "⚽", order: 60 },
  { id: "travel", titleKey: "stickerLibrary.category.travel", emoji: "🚀", order: 70 },
  { id: "objects", titleKey: "stickerLibrary.category.objects", emoji: "💡", order: 80 },
  { id: "symbols", titleKey: "stickerLibrary.category.symbols", emoji: "⭐", order: 90 },
];

/**
 * The curated quick palette (R11.1): reactions, status marks, planning
 * affordances and celebration glyphs — the vocabulary a planning board
 * actually uses. Rendered by the Inspector while the search box is
 * empty; every entry also exists in the full library (search finds them).
 */
export const CURATED_STICKERS: readonly string[] = [
  "⭐",
  "❤️",
  "🔥",
  "👍",
  "👏",
  "😀",
  "😂",
  "🤔",
  "😮",
  "😢",
  "🙌",
  "💪",
  "✅",
  "❌",
  "⚠️",
  "❓",
  "💡",
  "🎯",
  "🚀",
  "📌",
  "💎",
  "🎉",
  "🏆",
  "☕",
  "🕐",
  "📅",
  "💬",
  "✍️",
  "🔍",
  "🌱",
  "☔",
  "🌙",
];

/**
 * The full library: ~270 glyphs across the nine categories. Keywords are
 * matched SUBSTRING-wise after normalisation (see {@link searchStickers}).
 */
export const STICKER_LIBRARY: readonly StickerLibraryEntry[] = [
  // ── smileys ─────────────────────────────────────────────────────────
  { emoji: "😀", category: "smileys", keywords: ["صورتک", "خندان", "لبخند", "شاد", "smile", "happy", "grin", "face"] },
  { emoji: "😃", category: "smileys", keywords: ["صورتک", "خندان", "شاد", "smile", "happy", "face"] },
  { emoji: "😄", category: "smileys", keywords: ["صورتک", "خندان", "لبخند", "چشم", "smile", "happy", "beam"] },
  { emoji: "😁", category: "smileys", keywords: ["صورتک", "خندان", "دندان", "beam", "grin", "smile"] },
  { emoji: "😆", category: "smileys", keywords: ["صورتک", "خنده", "قهقهه", "شاد", "laugh", "lol", "happy"] },
  { emoji: "😅", category: "smileys", keywords: ["صورتک", "خنده", "عرق", "خجالت", "laugh", "sweat", "relief"] },
  { emoji: "🤣", category: "smileys", keywords: ["صورتک", "خنده", "غلتادن", "قهقهه", "rofl", "laugh", "lol"] },
  { emoji: "😂", category: "smileys", keywords: ["صورتک", "خنده", "اشک", "گریه از خنده", "joy", "laugh", "tears", "lol"] },
  { emoji: "🙂", category: "smileys", keywords: ["صورتک", "لبخند", "slightly", "smile"] },
  { emoji: "🙃", category: "smileys", keywords: ["صورتک", "برعکس", "شیطنت", "upside", "silly"] },
  { emoji: "😉", category: "smileys", keywords: ["صورتک", "چشمک", "wink", "smile"] },
  { emoji: "😊", category: "smileys", keywords: ["صورتک", "خندان", "چشم خندان", "blush", "smile", "happy"] },
  { emoji: "😇", category: "smileys", keywords: ["صورتک", "فرشته", "بی‌گناه", "angel", "halo", "innocent"] },
  { emoji: "🥰", category: "smileys", keywords: ["صورتک", "عاشق", "قلب چشم", "love", "hearts", "adore"] },
  { emoji: "😍", category: "smileys", keywords: ["صورتک", "عاشق", "چشم قلب", "علاقه", "love", "heart eyes", "adore"] },
  { emoji: "🤩", category: "smileys", keywords: ["صورتک", "مبهوت", "ستاره چشم", "wow", "star struck", "amazed"] },
  { emoji: "😘", category: "smileys", keywords: ["صورتک", "بوسه", "عشق", "kiss", "love"] },
  { emoji: "😋", category: "smileys", keywords: ["صورتک", "خوشمزه", "زبان", "yummy", "tongue", "delicious"] },
  { emoji: "😜", category: "smileys", keywords: ["صورتک", "شیطنت", "چشمک", "زبان", "wink", "tongue", "playful"] },
  { emoji: "🤪", category: "smileys", keywords: ["صورتک", "عجیب", "شیطنت", "zany", "crazy", "silly"] },
  { emoji: "🤗", category: "smileys", keywords: ["صورتک", "آغوش", "بغل", "hug", "embrace"] },
  { emoji: "🤭", category: "smileys", keywords: ["صورتک", "دست روی دهان", "خنده", "giggle", "oops"] },
  { emoji: "🤔", category: "smileys", keywords: ["صورتک", "فکر", "تردید", "think", "hmm", "considering"] },
  { emoji: "🫡", category: "smileys", keywords: ["صورتک", "احترام", "سلام نظامی", "salute"] },
  { emoji: "😐", category: "smileys", keywords: ["صورتک", "بی‌تفاوت", "خنثی", "neutral", "meh"] },
  { emoji: "😏", category: "smileys", keywords: ["صورتک", "شیطنت", "لبخند سرد", "smirk", "smug"] },
  { emoji: "😴", category: "smileys", keywords: ["صورتک", "خواب", "sleep", "zzz"] },
  { emoji: "🤤", category: "smileys", keywords: ["صورتک", "آب دهان", "drool", "yum"] },
  { emoji: "🥱", category: "smileys", keywords: ["صورتک", "خمیازه", "خسته", "yawn", "tired", "bored"] },
  { emoji: "🤯", category: "smileys", keywords: ["صورتک", "منفجر", "شگفت‌زده", "mind blown", "exploding", "shock"] },
  { emoji: "🥳", category: "smileys", keywords: ["صورتک", "جشن", "مهمون", "party", "celebrate"] },
  { emoji: "😎", category: "smileys", keywords: ["صورتک", "خیلی باحال", "عینک", "cool", "sunglasses"] },
  { emoji: "🤓", category: "smileys", keywords: ["صورتک", "مهندس", "nerd", "geek", "smart"] },
  { emoji: "🥺", category: "smileys", keywords: ["صورتک", "تمنا", "چشم گریان", "pleading", "puppy eyes"] },
  { emoji: "😢", category: "smileys", keywords: ["صورتک", "گریه", "غمگین", "اشک", "cry", "sad", "tear"] },
  { emoji: "😭", category: "smileys", keywords: ["صورتک", "گریه", "بلند گریه", "اشک", "cry", "sob", "bawl"] },
  { emoji: "😮", category: "smileys", keywords: ["صورتک", "متعجب", "دهان باز", "wow", "open mouth", "surprised"] },
  { emoji: "😱", category: "smileys", keywords: ["صورتک", "ترسیده", "جیغ", "scream", "fear", "shock"] },
  { emoji: "😤", category: "smileys", keywords: ["صورتک", "عصبانی", "باد", "triumph", "huff", "steam"] },
  { emoji: "😠", category: "smileys", keywords: ["صورتک", "عصبانی", "خشم", "angry", "mad", "rage"] },
  { emoji: "🤬", category: "smileys", keywords: ["صورتک", "فحش", "خیلی عصبانی", "swear", "curse"] },

  // ── gestures ─────────────────────────────────────────────────────────
  { emoji: "👍", category: "gestures", keywords: ["دست", "لایک", "تأیید", "خوب", "thumbs", "up", "like", "ok"] },
  { emoji: "👎", category: "gestures", keywords: ["دست", "دیسلایک", "بد", "نپسندیدن", "thumbs", "down", "dislike"] },
  { emoji: "👋", category: "gestures", keywords: ["دست", "سلام", "بای", "wave", "hello", "hi", "bye"] },
  { emoji: "🤚", category: "gestures", keywords: ["دست", "ایست", "توقف", "raised", "hand", "stop"] },
  { emoji: "✌️", category: "gestures", keywords: ["دست", "پیروزی", "صلح", "victory", "peace", "two"] },
  { emoji: "🤞", category: "gestures", keywords: ["دست", "امید", "شانس", "crossed", "fingers", "luck"] },
  { emoji: "🤟", category: "gestures", keywords: ["دست", "دوستت دارم", "love you"] },
  { emoji: "🤘", category: "gestures", keywords: ["دست", "راک", "شاخ", "rock", "horns", "metal"] },
  { emoji: "🤙", category: "gestures", keywords: ["دست", "زنگ بزن", "call me"] },
  { emoji: "👈", category: "gestures", keywords: ["دست", "اشاره", "چپ", "point", "left", "rtl"] },
  { emoji: "👉", category: "gestures", keywords: ["دست", "اشاره", "راست", "point", "right"] },
  { emoji: "👆", category: "gestures", keywords: ["دست", "اشاره", "بالا", "point", "up"] },
  { emoji: "👇", category: "gestures", keywords: ["دست", "اشاره", "پایین", "point", "down"] },
  { emoji: "☝️", category: "gestures", keywords: ["دست", "یک", "اشاره بالا", "index", "one"] },
  { emoji: "✍️", category: "gestures", keywords: ["دست", "نوشتن", "امضا", "write", "sign", "note"] },
  { emoji: "👏", category: "gestures", keywords: ["دست", "تحسین", "تشویق", "clap", "applause", "bravo"] },
  { emoji: "🙌", category: "gestures", keywords: ["دست", "هورا", "تشویق", "raise", "hands", "celebrate", "hooray"] },
  { emoji: "👐", category: "gestures", keywords: ["دست", "باز", "open", "hands"] },
  { emoji: "🤲", category: "gestures", keywords: ["دست", "التماس", "باز", "palms", "open"] },
  { emoji: "🤝", category: "gestures", keywords: ["دست", "دست دادن", "توافق", "handshake", "deal", "agree"] },
  { emoji: "🙏", category: "gestures", keywords: ["دست", "تشکر", "لطفا", "دعا", "thanks", "please", "pray"] },
  { emoji: "💪", category: "gestures", keywords: ["دست", "عضله", "قوی", "قدرت", "muscle", "strong", "flex"] },
  { emoji: "🦾", category: "gestures", keywords: ["دست", "ربات", "مکانیکی", "قوی", "mechanical", "arm", "robot", "strong"] },
  { emoji: "🫶", category: "gestures", keywords: ["دست", "قلب", "عشق", "heart", "hands", "love"] },
  { emoji: "👀", category: "gestures", keywords: ["چشم", "نگاه", "دنبال کردن", "eyes", "look", "watch"] },
  { emoji: "🧠", category: "gestures", keywords: ["مغز", "هوش", "ایده", "فکر", "brain", "smart", "idea"] },

  // ── hearts ───────────────────────────────────────────────────────────
  { emoji: "❤️", category: "hearts", keywords: ["قلب", "عشق", "دوست داشتن", "heart", "love", "red"] },
  { emoji: "🧡", category: "hearts", keywords: ["قلب", "نارنجی", "عشق", "heart", "orange"] },
  { emoji: "💛", category: "hearts", keywords: ["قلب", "زرد", "عشق", "heart", "yellow"] },
  { emoji: "💚", category: "hearts", keywords: ["قلب", "سبز", "عشق", "heart", "green"] },
  { emoji: "💜", category: "hearts", keywords: ["قلب", "بنفش", "عشق", "heart", "purple"] },
  { emoji: "🖤", category: "hearts", keywords: ["قلب", "سیاه", "عشق", "heart", "black"] },
  { emoji: "🤍", category: "hearts", keywords: ["قلب", "سفید", "عشق", "heart", "white"] },
  { emoji: "💔", category: "hearts", keywords: ["قلب", "شکسته", "غم", "broken", "heart", "sad"] },
  { emoji: "❤️‍🔥", category: "hearts", keywords: ["قلب", "شعله", "عشق داغ", "burning", "heart", "fire"] },
  { emoji: "💕", category: "hearts", keywords: ["قلب", "دو قلب", "عشق", "hearts", "love"] },
  { emoji: "💖", category: "hearts", keywords: ["قلب", "درخشش", "عشق", "sparkle", "heart", "love"] },
  { emoji: "💘", category: "hearts", keywords: ["قلب", "تیر", "عشق اول", "arrow", "heart", "cupid"] },
  { emoji: "💗", category: "hearts", keywords: ["قلب", "رشد", "عشق", "growing", "heart"] },
  { emoji: "💝", category: "hearts", keywords: ["قلب", "هدیه", "روبان", "gift", "heart", "ribbon"] },

  // ── animals ──────────────────────────────────────────────────────────
  { emoji: "🐱", category: "animals", keywords: ["حیوان", "گربه", "پشمالو", "cat", "kitty"] },
  { emoji: "🐶", category: "animals", keywords: ["حیوان", "سگ", "dog", "puppy"] },
  { emoji: "🐭", category: "animals", keywords: ["حیوان", "موش", "mouse"] },
  { emoji: "🐹", category: "animals", keywords: ["حیوان", "همستر", "hamster"] },
  { emoji: "🐰", category: "animals", keywords: ["حیوان", "خرگوش", "rabbit", "bunny"] },
  { emoji: "🦊", category: "animals", keywords: ["حیوان", "روباه", "fox"] },
  { emoji: "🐻", category: "animals", keywords: ["حیوان", "خرس", "bear"] },
  { emoji: "🐼", category: "animals", keywords: ["حیوان", "پاندا", "panda"] },
  { emoji: "🐨", category: "animals", keywords: ["حیوان", "کوآلا", "koala"] },
  { emoji: "🐯", category: "animals", keywords: ["حیوان", "ببر", "tiger"] },
  { emoji: "🦁", category: "animals", keywords: ["حیوان", "شیر", "lion"] },
  { emoji: "🐮", category: "animals", keywords: ["حیوان", "گاو", "cow"] },
  { emoji: "🐷", category: "animals", keywords: ["حیوان", "خوک", "pig"] },
  { emoji: "🐸", category: "animals", keywords: ["حیوان", "قورباغه", "frog"] },
  { emoji: "🐵", category: "animals", keywords: ["حیوان", "میمون", "monkey"] },
  { emoji: "🦉", category: "animals", keywords: ["حیوان", "جغد", "باهوش", "owl", "wise"] },
  { emoji: "🦅", category: "animals", keywords: ["حیوان", "عقاب", "eagle"] },
  { emoji: "🦄", category: "animals", keywords: ["حیوان", "تک‌شاخ", "unicorn", "magic"] },
  { emoji: "🐝", category: "animals", keywords: ["حیوان", "زنبور", "bee", "busy"] },
  { emoji: "🦋", category: "animals", keywords: ["حیوان", "پروانه", "butterfly"] },
  { emoji: "🐢", category: "animals", keywords: ["حیوان", "لاک‌پشت", "آهسته", "turtle", "slow"] },
  { emoji: "🐙", category: "animals", keywords: ["حیوان", "اختاپوس", "octopus"] },
  { emoji: "🐳", category: "animals", keywords: ["حیوان", "نهنگ", "whale"] },
  { emoji: "🐠", category: "animals", keywords: ["حیوان", "ماهی", "fish", "tropical"] },
  { emoji: "🌱", category: "animals", keywords: ["طبیعت", "جوانه", "گیاه", "رشد", "seedling", "sprout", "grow"] },

  // ── food ────────────────────────────────────────────────────────────
  { emoji: "☕", category: "food", keywords: ["نوشیدنی", "قهوه", "چای", "coffee", "tea", "break"] },
  { emoji: "🍵", category: "food", keywords: ["نوشیدنی", "چای سبز", "tea", "green"] },
  { emoji: "🥤", category: "food", keywords: ["نوشیدنی", "نوشابه", "soda", "drink", "cup"] },
  { emoji: "🍎", category: "food", keywords: ["خوراکی", "سیب", "apple", "fruit"] },
  { emoji: "🍏", category: "food", keywords: ["خوراکی", "سیب سبز", "apple", "green"] },
  { emoji: "🍊", category: "food", keywords: ["خوراکی", "پرتقال", "orange", "fruit"] },
  { emoji: "🍋", category: "food", keywords: ["خوراکی", "لیمو", "lemon", "lime"] },
  { emoji: "🍉", category: "food", keywords: ["خوراکی", "هندوانه", "watermelon"] },
  { emoji: "🍇", category: "food", keywords: ["خوراکی", "انگور", "grapes"] },
  { emoji: "🍌", category: "food", keywords: ["خوراکی", "موز", "banana"] },
  { emoji: "🍕", category: "food", keywords: ["خوراکی", "پیتزا", "pizza", "party"] },
  { emoji: "🍔", category: "food", keywords: ["خوراکی", "همبرگر", "burger"] },
  { emoji: "🍟", category: "food", keywords: ["خوراکی", "سیب‌زمینی سرخ‌کرده", "fries"] },
  { emoji: "🌮", category: "food", keywords: ["خوراکی", "تاکو", "taco"] },
  { emoji: "🍜", category: "food", keywords: ["خوراکی", "رامن", "نودل", "ramen", "noodles"] },
  { emoji: "🍣", category: "food", keywords: ["خوراکی", "سوشی", "sushi"] },
  { emoji: "🍩", category: "food", keywords: ["خوراکی", "دونات", "donut", "sweet"] },
  { emoji: "🍪", category: "food", keywords: ["خوراکی", "کلوچه", "cookie"] },
  { emoji: "🎂", category: "food", keywords: ["خوراکی", "کیک", "تولد", "cake", "birthday"] },
  { emoji: "🍰", category: "food", keywords: ["خوراکی", "شیرینی", "کیک", "cake", "slice", "dessert"] },
  { emoji: "🍫", category: "food", keywords: ["خوراکی", "شکلات", "chocolate"] },
  { emoji: "🍿", category: "food", keywords: ["خوراکی", "پاپ‌کورن", "فیلم", "popcorn", "movie"] },
  { emoji: "🧁", category: "food", keywords: ["خوراکی", "کیک فنجانی", "cupcake"] },
  { emoji: "🍯", category: "food", keywords: ["خوراکی", "عسل", "honey", "sweet"] },
  { emoji: "🥗", category: "food", keywords: ["خوراکی", "سالاد", "سلامت", "salad", "healthy"] },

  // ── activities ───────────────────────────────────────────────────────
  { emoji: "⚽", category: "activities", keywords: ["ورزش", "فوتبال", "توپ", "soccer", "football", "ball"] },
  { emoji: "🏀", category: "activities", keywords: ["ورزش", "بسکتبال", "basketball"] },
  { emoji: "🎾", category: "activities", keywords: ["ورزش", "تنیس", "tennis"] },
  { emoji: "🏐", category: "activities", keywords: ["ورزش", "والیبال", "volleyball"] },
  { emoji: "🏓", category: "activities", keywords: ["ورزش", "پینگ‌پنگ", "table tennis", "ping pong"] },
  { emoji: "🎮", category: "activities", keywords: ["بازی", "گیم", "کنترل", "game", "controller", "gaming"] },
  { emoji: "🎯", category: "activities", keywords: ["هدف", "تیراندازی", "دقیق", "هدف‌گذاری", "target", "bullseye", "goal"] },
  { emoji: "🏆", category: "activities", keywords: ["جام", "قهرمانی", "برنده", "موفقیت", "trophy", "win", "champion"] },
  { emoji: "🥇", category: "activities", keywords: ["مدال", "طلا", "اول", "قهرمان", "gold", "medal", "first"] },
  { emoji: "🎨", category: "activities", keywords: ["هنر", "نقاشی", "رنگ", "خلاقیت", "art", "paint", "palette", "design"] },
  { emoji: "🎬", category: "activities", keywords: ["فیلم", "کلکسیون", "سینما", "movie", "film", "clapper"] },
  { emoji: "🎤", category: "activities", keywords: ["میکروفون", "آواز", "صدا", "mic", "sing", "voice"] },
  { emoji: "🎧", category: "activities", keywords: ["هدفون", "موسیقی", "صدا", "headphones", "music", "audio"] },
  { emoji: "🎸", category: "activities", keywords: ["گیتار", "موسیقی", "guitar", "music"] },
  { emoji: "🎹", category: "activities", keywords: ["پیانو", "کیبورد", "موسیقی", "piano", "keyboard", "music"] },
  { emoji: "🎲", category: "activities", keywords: ["تاس", "شانس", "بازی", "dice", "game", "random"] },
  { emoji: "🧩", category: "activities", keywords: ["پازل", "معما", "قسمت", "puzzle", "piece", "solve"] },
  { emoji: "💻", category: "activities", keywords: ["رایانه", "لپ‌تاپ", "کدنویسی", "برنامه‌نویسی", "laptop", "computer", "code", "dev"] },
  { emoji: "🖥️", category: "activities", keywords: ["رایانه", "دسکتاپ", "مانیتور", "desktop", "computer", "screen"] },
  { emoji: "📱", category: "activities", keywords: ["گوشی", "موبایل", "تلفن", "phone", "mobile"] },
  { emoji: "⌨️", category: "activities", keywords: ["کیبورد", "تایپ", "keyboard", "type"] },
  { emoji: "🕹️", category: "activities", keywords: ["جوی‌استیک", "بازی", "arcade", "joystick", "game"] },

  // ── travel ──────────────────────────────────────────────────────────
  { emoji: "🚀", category: "travel", keywords: ["موشک", "پرتاب", "شروع", "سرعت", "پیشرفت", "rocket", "launch", "start", "ship"] },
  { emoji: "✈️", category: "travel", keywords: ["هواپیما", "پرواز", "سفر", "plane", "flight", "travel"] },
  { emoji: "🚗", category: "travel", keywords: ["ماشین", "خودرو", "car", "auto"] },
  { emoji: "🚕", category: "travel", keywords: ["تاکسی", "taxi", "cab"] },
  { emoji: "🚌", category: "travel", keywords: ["اتوبوس", "bus"] },
  { emoji: "🚲", category: "travel", keywords: ["دوچرخه", "bicycle", "bike"] },
  { emoji: "🛵", category: "travel", keywords: ["موتور", "اسکوتر", "scooter", "moped"] },
  { emoji: "🚂", category: "travel", keywords: ["قطار", "train", "railway"] },
  { emoji: "🚢", category: "travel", keywords: ["کشتی", "قایق", "ship", "boat"] },
  { emoji: "🗺️", category: "travel", keywords: ["نقشه", "جهان", "مسیر", "map", "world", "route"] },
  { emoji: "🧭", category: "travel", keywords: ["قطب‌نما", "جهت", "راهنما", "compass", "navigate"] },
  { emoji: "🏝️", category: "travel", keywords: ["جزیره", "سفر", "تعطیلات", "island", "vacation"] },
  { emoji: "🏔️", category: "travel", keywords: ["کوه", "قله", "چالش", "mountain", "summit", "peak"] },
  { emoji: "🌋", category: "travel", keywords: ["آتشفشان", "فوران", "volcano", "eruption"] },
  { emoji: "🌙", category: "travel", keywords: ["ماه", "شب", "شبانه", "moon", "night"] },
  { emoji: "☀️", category: "travel", keywords: ["خورشید", "روز", "روشن", "sun", "day", "sunny"] },
  { emoji: "☔", category: "travel", keywords: ["باران", "چتر", "rain", "umbrella"] },
  { emoji: "❄️", category: "travel", keywords: ["برف", "سرد", "snow", "cold", "winter"] },
  { emoji: "🌈", category: "travel", keywords: ["رنگین‌کمان", "رنگی", "rainbow", "colors"] },
  { emoji: "🌍", category: "travel", keywords: ["زمین", "جهان", "کره", "earth", "world", "globe"] },

  // ── objects ──────────────────────────────────────────────────────────
  { emoji: "💡", category: "objects", keywords: ["ایده", "لامپ", "خلاقیت", "نور", "idea", "light", "bulb", "insight"] },
  { emoji: "📌", category: "objects", keywords: ["سنجاق", "نشان", "مهم", "پین", "pin", "important", "mark"] },
  { emoji: "📍", category: "objects", keywords: ["مکان", "نشان", "محل", "location", "place", "pin"] },
  { emoji: "📎", category: "objects", keywords: ["گیره کاغذ", "پیوست", "clip", "attach"] },
  { emoji: "🔒", category: "objects", keywords: ["قفل", "امنیت", "بسته", "locked", "lock", "secure"] },
  { emoji: "🔓", category: "objects", keywords: ["باز", "قفل باز", "unlocked", "open"] },
  { emoji: "🔑", category: "objects", keywords: ["کلید", "راه‌حل", "key", "solution"] },
  { emoji: "🔨", category: "objects", keywords: ["چکش", "ابزار", "ساخت", "hammer", "tool", "build"] },
  { emoji: "🛠️", category: "objects", keywords: ["ابزار", "تعمیر", "tools", "fix"] },
  { emoji: "⚙️", category: "objects", keywords: ["تنظیمات", "چرخ‌دنده", "پیکربندی", "gear", "settings", "config"] },
  { emoji: "🔧", category: "objects", keywords: ["آچار", "تنظیم", "wrench", "fix"] },
  { emoji: "🔋", category: "objects", keywords: ["باتری", "انرژی", "شارژ", "battery", "energy", "power"] },
  { emoji: "🔌", category: "objects", keywords: ["پریز", "برق", "اتصال", "plug", "power"] },
  { emoji: "🔍", category: "objects", keywords: ["ذره‌بین", "جستجو", "بازرسی", "search", "zoom", "inspect"] },
  { emoji: "🔭", category: "objects", keywords: ["تلسکوپ", "دیدن", "آینده", "telescope", "vision"] },
  { emoji: "🔬", category: "objects", keywords: ["میکروسکوپ", "بررسی دقیق", "microscope", "research"] },
  { emoji: "📅", category: "objects", keywords: ["تقویم", "تاریخ", "زمان‌بندی", "رویداد", "calendar", "date", "schedule"] },
  { emoji: "🕐", category: "objects", keywords: ["ساعت", "زمان", "clock", "time", "oclock"] },
  { emoji: "⏰", category: "objects", keywords: ["ساعت زنگ‌دار", "یادآور", "alarm", "reminder", "time"] },
  { emoji: "⏳", category: "objects", keywords: ["شیشه ساعت", "در انتظار", "زمان", "hourglass", "wait", "time"] },
  { emoji: "📝", category: "objects", keywords: ["یادداشت", "نوشتن", "متن", "note", "memo", "write"] },
  { emoji: "✏️", category: "objects", keywords: ["مداد", "نوشتن", "ویرایش", "pencil", "edit", "write"] },
  { emoji: "🖊️", category: "objects", keywords: ["خودکار", "قلم", "pen", "write"] },
  { emoji: "📊", category: "objects", keywords: ["نمودار میله‌ای", "آمار", "داده", "bar chart", "stats", "data"] },
  { emoji: "📈", category: "objects", keywords: ["نمودار", "رشد", "افزایش", "پیشرفت", "chart", "growth", "trend up"] },
  { emoji: "📉", category: "objects", keywords: ["نمودار", "کاهش", "شکست", "chart", "decline", "down"] },
  { emoji: "🗂️", category: "objects", keywords: ["پوشه", "بایگانی", "سازمان‌دهی", "folder", "organize", "files"] },
  { emoji: "📋", category: "objects", keywords: ["کلیپ‌بورد", "لیست", "فهرست", "clipboard", "list", "checklist"] },
  { emoji: "📁", category: "objects", keywords: ["پوشه", "پرونده", "folder", "file"] },
  { emoji: "🗓️", category: "objects", keywords: ["تقویم", "برنامه", "رویداد", "datebook", "calendar", "planner"] },
  { emoji: "🧲", category: "objects", keywords: ["آهنربا", "جذب", "magnet", "attract"] },
  { emoji: "💎", category: "objects", keywords: ["الماس", "جواهر", "ارزشمند", "gem", "diamond", "value"] },

  // ── symbols ─────────────────────────────────────────────────────────
  { emoji: "⭐", category: "symbols", keywords: ["ستاره", "مورد علاقه", "مهم", "star", "favorite", "featured"] },
  { emoji: "🌟", category: "symbols", keywords: ["درخشش", "برجسته", "ستاره", "glow", "star", "shine", "sparkle"] },
  { emoji: "✨", category: "symbols", keywords: ["درخشش", "جادو", "براق", "sparkles", "magic", "shine"] },
  { emoji: "⚡", category: "symbols", keywords: ["برق", "سریع", "انرژی", "فوری", "zap", "lightning", "fast", "energy"] },
  { emoji: "🔥", category: "symbols", keywords: ["آتش", "داغ", "محبوب", "فوری", "fire", "hot", "trend", "flame"] },
  { emoji: "✅", category: "symbols", keywords: ["تأیید", "انجام شد", "درست", "چک", "check", "done", "complete", "yes"] },
  { emoji: "☑️", category: "symbols", keywords: ["انتخاب", "چک‌باکس", "تأیید", "checkbox", "checked"] },
  { emoji: "❌", category: "symbols", keywords: ["خطا", "نادرست", "حذف", "ضربدر", "x", "cross", "wrong", "no"] },
  { emoji: "⚠️", category: "symbols", keywords: ["هشدار", "احتیاط", "خطر", "warning", "caution", "alert"] },
  { emoji: "❓", category: "symbols", keywords: ["سؤال", "نامشخص", "سوال", "question", "unknown"] },
  { emoji: "❗", category: "symbols", keywords: ["تأکید", "مهم", "فوری", "exclamation", "important"] },
  { emoji: "💯", category: "symbols", keywords: ["صد", "کامل", "عالی", "100", "perfect", "score"] },
  { emoji: "🎉", category: "symbols", keywords: ["جشن", "مبارکباد", "شادی", "party", "celebrate", "tada"] },
  { emoji: "🎊", category: "symbols", keywords: ["جشن", "کاغذرنگی", "confetti", "party"] },
  { emoji: "🔔", category: "symbols", keywords: ["زنگ", "اعلان", "یادآوری", "bell", "notification", "alert"] },
  { emoji: "🔕", category: "symbols", keywords: ["بی‌صدا", "اعلان خاموش", "mute", "silent", "off"] },
  { emoji: "💬", category: "symbols", keywords: ["گفتگو", "نظر", "پیام", "speech", "comment", "chat", "message"] },
  { emoji: "👁️", category: "symbols", keywords: ["چشم", "دیدن", "بازبینی", "eye", "visible", "review"] },
  { emoji: "♻️", category: "symbols", keywords: ["بازیافت", "تکرار", "دوباره", "recycle", "repeat", "loop"] },
  { emoji: "🔰", category: "symbols", keywords: ["مبتدی", "شروع", "beginner", "new"] },
  { emoji: "⏸️", category: "symbols", keywords: ["توقف", "مکث", "pause", "hold"] },
  { emoji: "▶️", category: "symbols", keywords: ["پخش", "شروع", "اجرا", "play", "start", "run"] },
  { emoji: "🔁", category: "symbols", keywords: ["تکرار", "چرخه", "repeat", "loop", "cycle"] },
  { emoji: "🏁", category: "symbols", keywords: ["پایان", "خط پایان", "finish", "flag", "done"] },
  { emoji: "🚩", category: "symbols", keywords: ["پرچم", "نشانه", "flag", "mark"] },
  { emoji: "💤", category: "symbols", keywords: ["خواب", "تعویق", "zzz", "sleep", "later"] },
  { emoji: "💫", category: "symbols", keywords: ["سرگیجه", "ستاره", "جادو", "dizzy", "star", "magic"] },
  { emoji: "🆗", category: "symbols", keywords: ["اوکی", "تأیید", "ok", "approve"] },
];

/** Normalised keyword lookup (built once at module load). */
const KEYWORD_INDEX: ReadonlyMap<StickerLibraryEntry, readonly string[]> =
  new Map(
    STICKER_LIBRARY.map((entry) => [
      entry,
      entry.keywords.map((keyword) => normalizeStickerQuery(keyword)),
    ]),
  );

/** The set of every known category id (validation fast path). */
const CATEGORY_IDS: ReadonlySet<string> = new Set(
  STICKER_CATEGORIES.map((category) => category.id),
);

/**
 * @param id - the value to test.
 * @returns whether the value names a known sticker category.
 */
export function isStickerCategoryId(id: string): id is StickerCategoryId {
  return CATEGORY_IDS.has(id);
}

/**
 * Normalises a search query or keyword for matching: trim + lowercase,
 * Arabic yeh/kaf → Persian, ZWNJ → space, whitespace folding. This makes
 * «كتاب» ≡ «کتاب» and «می‌شود» ≡ «می شد» — real typos Persian users hit.
 *
 * @param raw - the raw query/keyword.
 * @returns the normalised needle.
 */
export function normalizeStickerQuery(raw: string): string {
  return raw
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/\u200c/g, " ")
    .replace(/\s+/g, " ");
}

/**
 * Searches the library with TOKEN-AND semantics: the query splits on
 * whitespace and an entry matches when EVERY token is contained in at
 * least one keyword (substring, so «ستا» finds «ستاره» and «thumbs up»
 * finds 👍 whose keywords include both words), or the whole needle is
 * the emoji glyph itself (paste-to-find). Empty needles match nothing —
 * callers render the curated palette / category grid instead.
 *
 * @param query - the raw user query.
 * @returns the matching entries in library order.
 */
export function searchStickers(query: string): readonly StickerLibraryEntry[] {
  const needle = normalizeStickerQuery(query);
  if (needle === "") {
    return [];
  }
  const tokens = needle.split(" ");
  const emojiNeedle = query.trim();
  return STICKER_LIBRARY.filter((entry) => {
    if (tokens.length === 1 && entry.emoji === emojiNeedle) {
      return true;
    }
    const keywords = KEYWORD_INDEX.get(entry);
    if (keywords === undefined) {
      return false;
    }
    for (const token of tokens) {
      let matched = false;
      for (const keyword of keywords) {
        if (keyword.includes(token)) {
          matched = true;
          break;
        }
      }
      if (!matched) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Filters the library to one category (the picker's category tab).
 *
 * @param category - the category id.
 * @returns the category's entries in library order.
 */
export function stickersOfCategory(
  category: StickerCategoryId,
): readonly StickerLibraryEntry[] {
  return STICKER_LIBRARY.filter((entry) => entry.category === category);
}
