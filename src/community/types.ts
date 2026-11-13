/**
 * Places people register in the app ("My places"): a name, a kind, a note, contact details and
 * a pin with an optional direction of travel, either private (only you) or public (everyone
 * using this JunctionNav site). They live in this browser, and with a shared places service
 * (Supabase, see supabase/shared-places.sql) also on every device you sign in on, and public
 * ones for everyone.
 */
import type { LngLat } from '../geo/geo';
import { GROUP_IDS, GROUPS, type PlaceGroup } from '../places/format';
import type { LangCode } from '../routing/instructions';

export type Visibility = 'private' | 'public';

export interface SharedPlace {
  id: string;
  name: string;
  /** One of the place groups (src/places/format.ts). */
  category: PlaceGroup;
  note: string;
  phone: string;
  website: string;
  lngLat: LngLat;
  /** Direction of travel there (degrees), so a route arrives on the right carriageway; null: any. */
  heading: number | null;
  visibility: Visibility;
  /** Who added it (first name), shown on public places. */
  ownerName: string;
  /** The owner's account id ('' for places kept only in this browser). */
  owner: string;
  /** Last change (ms). */
  updated: number;
  /** Hidden from everyone else after reports (the owner still sees it). */
  hidden?: boolean;
}

/** One of your places as this browser keeps it, with what the shared service has of it. */
export interface LocalPlace extends SharedPlace {
  /** The shared service has this version (nothing to send). */
  synced: boolean;
  /** The shared service has the place at all (an update rather than a new one). */
  remote: boolean;
  /** Deleted here, still to be deleted there. */
  deleted?: boolean;
}

/** Places the form offers, in a useful order (the rest of the groups follow). */
export const FORM_GROUPS: PlaceGroup[] = ['food', 'cafe', 'grocery', 'shop', 'mall', 'fuel', 'ev', 'parking', 'car', 'rest', 'hotel', 'health', 'education', 'worship', 'bank', 'government', 'transport', 'attraction', 'park', 'sport', 'leisure', 'service', 'office', 'other'];

export function isGroup(v: unknown): v is PlaceGroup {
  return typeof v === 'string' && (GROUP_IDS as string[]).includes(v);
}

export function groupLabel(g: PlaceGroup, lang: LangCode): string {
  return GROUPS[g].label[lang] ?? GROUPS[g].label.en;
}

export const NAME_MAX = 80;
export const NOTE_MAX = 500;

/** Cleans what the form or a link gives, so it fits what the service accepts. */
export function cleanFields(p: Pick<SharedPlace, 'name' | 'note' | 'phone' | 'website'>): Pick<SharedPlace, 'name' | 'note' | 'phone' | 'website'> {
  const one = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max);
  let website = one(p.website, 200);
  if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
  return { name: one(p.name, NAME_MAX), note: p.note.replace(/\r/g, '').trim().slice(0, NOTE_MAX), phone: one(p.phone, 30), website };
}

/** Words for the place card, the form and the lists, in the app's languages. */
export interface PlaceWords {
  myPlaces: string;
  addPlace: string;
  addThisPlace: string;
  editPlace: string;
  name: string;
  kind: string;
  note: string;
  notePlaceholder: string;
  phone: string;
  website: string;
  location: string;
  movePin: string;
  direction: string;
  anyDirection: string;
  whoSees: string;
  private: string;
  privateHint: string;
  public: string;
  publicHint: string;
  publicNeedsAccount: string;
  publicNeedsService: string;
  save: string;
  cancel: string;
  delete: string;
  deleteConfirm: string;
  deleted: string;
  saved: string;
  yourPlace: string;
  addedBy: (name: string) => string;
  share: string;
  linkCopied: string;
  report: string;
  reportReason: string;
  reported: string;
  hiddenByReports: string;
  notSynced: string;
  openGoogle: string;
  needName: string;
  fromLink: string;
  saveToMine: string;
  useSpot: string;
  mine: string;
  edit: string;
  heading: (dir: string) => string;
  shareText: (name: string) => string;
  savedHere: string;
  placeGone: string;
  reasons: string[];
  needAccountToReport: string;
}

const EN: PlaceWords = {
  myPlaces: 'My places',
  addPlace: 'Add a place',
  addThisPlace: 'Add to my places',
  editPlace: 'Edit place',
  name: 'Name',
  kind: 'Kind of place',
  note: 'Note',
  notePlaceholder: 'Opening hours, which entrance, what to know',
  phone: 'Phone',
  website: 'Website',
  location: 'Location',
  movePin: 'Move pin',
  direction: 'Direction of travel',
  anyDirection: 'Any direction',
  whoSees: 'Who can see it',
  private: 'Private',
  privateHint: 'Only you, on every device you sign in on.',
  public: 'Public',
  publicHint: 'Everyone using JunctionNav can find it, with your first name on it.',
  publicNeedsAccount: 'Sign in to share public places.',
  publicNeedsService: 'Public places need the shared places service, which this site has not set up. Your place is kept on this device.',
  save: 'Save',
  cancel: 'Cancel',
  delete: 'Delete',
  deleteConfirm: 'Tap again to delete',
  deleted: 'Place deleted',
  saved: 'Place saved',
  yourPlace: 'Your place',
  addedBy: (n) => (n ? `Added by ${n}` : 'Added by a JunctionNav user'),
  share: 'Share',
  linkCopied: 'Link copied',
  report: 'Report',
  reportReason: 'What is wrong with this place?',
  reported: 'Thanks. Places reported by three people are hidden.',
  hiddenByReports: 'Hidden from others after reports. Check it and fix it if needed.',
  notSynced: 'Not uploaded yet',
  openGoogle: 'Google Maps',
  needName: 'Give the place a name.',
  fromLink: 'Shared with you',
  saveToMine: 'Save to my places',
  useSpot: 'Use this spot',
  mine: 'Mine',
  edit: 'Edit',
  heading: (d) => `Arrive heading ${d}`,
  shareText: (n) => `${n} on JunctionNav`,
  savedHere: 'Kept on this device',
  placeGone: 'This place is no longer shared.',
  reasons: ['Wrong location', 'Closed or gone', 'Wrong details', 'Spam or offensive'],
  needAccountToReport: 'Sign in to report a place.',
};

const MS: PlaceWords = {
  ...EN,
  myPlaces: 'Tempat saya',
  addPlace: 'Tambah tempat',
  addThisPlace: 'Tambah ke tempat saya',
  editPlace: 'Ubah tempat',
  name: 'Nama',
  kind: 'Jenis tempat',
  note: 'Nota',
  notePlaceholder: 'Waktu buka, pintu masuk mana, perkara penting',
  phone: 'Telefon',
  website: 'Laman web',
  location: 'Lokasi',
  movePin: 'Alih pin',
  direction: 'Arah perjalanan',
  anyDirection: 'Mana-mana arah',
  whoSees: 'Siapa boleh lihat',
  private: 'Peribadi',
  privateHint: 'Hanya anda, pada setiap peranti yang anda log masuk.',
  public: 'Awam',
  publicHint: 'Semua pengguna JunctionNav boleh mencarinya, dengan nama pertama anda.',
  publicNeedsAccount: 'Log masuk untuk berkongsi tempat awam.',
  publicNeedsService: 'Tempat awam memerlukan perkhidmatan tempat dikongsi yang belum disediakan di laman ini. Tempat anda disimpan pada peranti ini.',
  save: 'Simpan',
  cancel: 'Batal',
  delete: 'Padam',
  deleteConfirm: 'Ketik sekali lagi untuk padam',
  deleted: 'Tempat dipadam',
  saved: 'Tempat disimpan',
  yourPlace: 'Tempat anda',
  addedBy: (n) => (n ? `Ditambah oleh ${n}` : 'Ditambah oleh pengguna JunctionNav'),
  share: 'Kongsi',
  linkCopied: 'Pautan disalin',
  report: 'Laporkan',
  reportReason: 'Apakah yang salah dengan tempat ini?',
  reported: 'Terima kasih. Tempat yang dilaporkan oleh tiga orang akan disembunyikan.',
  hiddenByReports: 'Disembunyikan daripada orang lain selepas laporan. Semak dan betulkan jika perlu.',
  notSynced: 'Belum dimuat naik',
  needName: 'Berikan nama tempat ini.',
  fromLink: 'Dikongsi dengan anda',
  saveToMine: 'Simpan ke tempat saya',
  useSpot: 'Guna lokasi ini',
  mine: 'Milik saya',
  edit: 'Ubah',
  heading: (d) => `Tiba menghala ${d}`,
  shareText: (n) => `${n} di JunctionNav`,
  savedHere: 'Disimpan pada peranti ini',
  placeGone: 'Tempat ini tidak lagi dikongsi.',
  reasons: ['Lokasi salah', 'Tutup atau tiada lagi', 'Butiran salah', 'Spam atau menyinggung'],
  needAccountToReport: 'Log masuk untuk melaporkan tempat.',
};

const JA: PlaceWords = {
  ...EN,
  myPlaces: 'マイスポット',
  addPlace: 'スポットを登録',
  addThisPlace: 'マイスポットに登録',
  editPlace: 'スポットを編集',
  name: '名前',
  kind: '種類',
  note: 'メモ',
  notePlaceholder: '営業時間、入口、注意点など',
  phone: '電話',
  website: 'ウェブサイト',
  location: '場所',
  movePin: 'ピンを動かす',
  direction: '進行方向',
  anyDirection: 'どの方向でも',
  whoSees: '公開範囲',
  private: '非公開',
  privateHint: '自分だけ（サインインした全端末）。',
  public: '公開',
  publicHint: 'JunctionNavの全ユーザーが検索でき、あなたの名前（名）が表示されます。',
  publicNeedsAccount: '公開スポットを共有するにはサインインしてください。',
  publicNeedsService: 'このサイトでは共有スポットのサービスが設定されていないため、公開できません。この端末に保存されます。',
  save: '保存',
  cancel: 'キャンセル',
  delete: '削除',
  deleteConfirm: 'もう一度タップで削除',
  deleted: 'スポットを削除しました',
  saved: 'スポットを保存しました',
  yourPlace: 'あなたのスポット',
  addedBy: (n) => (n ? `${n}さんが登録` : 'JunctionNavユーザーが登録'),
  share: '共有',
  linkCopied: 'リンクをコピーしました',
  report: '報告',
  reportReason: 'このスポットの問題は何ですか？',
  reported: 'ありがとうございます。3人から報告されたスポットは非表示になります。',
  hiddenByReports: '報告により他の人には非表示です。内容を確認して修正してください。',
  notSynced: '未アップロード',
  needName: 'スポットの名前を入力してください。',
  fromLink: '共有されたスポット',
  saveToMine: 'マイスポットに保存',
  useSpot: 'この地点にする',
  mine: 'マイ',
  edit: '編集',
  heading: (d) => `${d}向きで到着`,
  shareText: (n) => `JunctionNavの${n}`,
  savedHere: 'この端末に保存',
  placeGone: 'このスポットは共有されなくなりました。',
  reasons: ['場所が違う', '閉店・存在しない', '情報が違う', 'スパム・不適切'],
  needAccountToReport: '報告するにはサインインしてください。',
};

export function placeWords(lang: LangCode): PlaceWords {
  return lang === 'ms' ? MS : lang === 'ja' ? JA : EN;
}
