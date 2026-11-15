/**
 * Interesting places to discover around the map: attractions and landmarks, foods, resorts,
 * theme parks and shopping malls, gathered on demand from free, open sources (OpenStreetMap,
 * Wikivoyage, Wikipedia, Wikidata and Wikimedia Commons), each with the links it came from.
 */
import type { LngLat } from '../geo/geo';
import type { LangCode } from '../routing/instructions';

export type DiscoverCat = 'attractions' | 'food' | 'resorts' | 'themeparks' | 'malls';
export const DISCOVER_CATS: DiscoverCat[] = ['attractions', 'food', 'resorts', 'themeparks', 'malls'];

/** Where a piece of a place came from. */
export type SourceKind = 'osm' | 'wikivoyage' | 'wikipedia' | 'wikidata' | 'commons' | 'website' | 'facebook' | 'instagram' | 'tiktok' | 'local';

export interface SourceLink {
  kind: SourceKind;
  url: string;
  /** What to show ("OpenStreetMap", "Wikivoyage: Kuala Lumpur/Bukit Bintang", "@yutkee"). */
  label: string;
}

export interface DiscoverPhoto {
  /** A thumbnail about 480 px wide. */
  url: string;
  /** The Commons file ("File:Petronas Towers.jpg"), for the credit and its page. */
  file?: string;
  /** Who took it and the licence, once looked up ("Photo: Jane Doe, CC BY-SA 4.0"). */
  credit?: string;
  /** The photo's own page. */
  page?: string;
}

export interface DiscoverPlace {
  /** Stable for the place: "osm:node/123", "wv:Title#Name", "wp:en:Title". */
  id: string;
  name: string;
  lngLat: LngLat;
  cat: DiscoverCat;
  /** The kind in words ("Museum", "Malaysian restaurant", "Theme park"). */
  kind: string;
  /** A sentence or two about it (Wikivoyage's or Wikipedia's words). */
  about?: string;
  /** Where the words in `about` come from. */
  aboutFrom?: SourceKind;
  photo?: DiscoverPhoto;
  address?: string;
  hours?: string;
  phone?: string;
  website?: string;
  cuisine?: string;
  price?: string;
  /** The town or district, for looking it up elsewhere. */
  area?: string;
  wikidata?: string;
  /** Recommended by travellers (a Wikivoyage listing). */
  pick?: boolean;
  /** The place's own pages on social media (from OpenStreetMap). */
  social: { facebook?: string; instagram?: string; tiktok?: string };
  sources: SourceLink[];
  /** How well known it seems, for the order (higher first). */
  score: number;
  /** A chain (brand), listed after local places. */
  chain?: boolean;
}

export interface DiscoverResult {
  cat: DiscoverCat;
  center: LngLat;
  /** Metres around the centre that were searched. */
  radius: number;
  places: DiscoverPlace[];
  /** When it was gathered (ms). */
  at: number;
  /** Which sources answered, and which could not be reached. */
  used: SourceKind[];
  failed: SourceKind[];
}

type Words = {
  tab: string;
  hint: string;
  justNow: string;
  minAgo: (n: number) => string;
  hAgo: (n: number) => string;
  hereSaved: string;
  saved: string;
  discover: string;
  cats: Record<DiscoverCat, string>;
  around: (km: string) => string;
  updated: (ago: string) => string;
  refresh: string;
  loading: string;
  none: string;
  offline: string;
  pickBadge: string;
  sources: string;
  lookUp: string;
  photoFrom: string;
  aboutFrom: (src: string) => string;
  credits: string;
  partial: (names: string) => string;
  home: string;
  work: string;
  groups: string;
  newGroup: string;
  groupName: string;
  create: string;
  rename: string;
  remove: string;
  removeGroup: string;
  confirmRemoveGroup: (n: number) => string;
  showOnMap: string;
  moveTo: string;
  empty: string;
  emptyGroup: string;
  places: (n: number) => string;
  saveTo: string;
  savedTo: (g: string) => string;
  removedFrom: (g: string) => string;
  note: string;
  link: string;
  linkHint: string;
  pins: string;
  myPlaces: string;
  recents: string;
  clearRecents: string;
  favourites: string;
  wantToGo: string;
  done: string;
  cancel: string;
  saveBtn: string;
  more: (n: number) => string;
};

const EN: Words = {
  tab: 'Places',
  hint: 'Tap a kind of place to find the best known ones around the map centre, with photos and where each comes from. Move the map to look somewhere else.',
  justNow: 'just now',
  minAgo: (n) => `${n} min ago`,
  hAgo: (n) => `${n} h ago`,
  hereSaved: 'Saved places stay on this phone with your account.',
  saved: 'Saved',
  discover: 'Discover',
  cats: { attractions: 'Attractions', food: 'Foods', resorts: 'Resorts', themeparks: 'Theme parks', malls: 'Shopping malls' },
  around: (km) => `Around the map centre, within ${km}`,
  updated: (ago) => `Updated ${ago}`,
  refresh: 'Refresh',
  loading: 'Looking for places…',
  none: 'Nothing found around here. Move the map or zoom out, then try again.',
  offline: 'No internet: places from this phone, without photos.',
  pickBadge: 'Traveller pick',
  sources: 'Sources',
  lookUp: 'Look it up',
  photoFrom: 'Photo',
  aboutFrom: (src) => `From ${src}`,
  credits: 'Places from OpenStreetMap contributors (ODbL), Wikivoyage and Wikipedia (CC BY-SA), photos from Wikimedia Commons. Social pages as listed on OpenStreetMap.',
  partial: (names) => `${names} could not be reached; showing the rest.`,
  home: 'Home',
  work: 'Work',
  groups: 'Groups',
  newGroup: 'New group',
  groupName: 'Group name',
  create: 'Create',
  rename: 'Rename',
  remove: 'Remove',
  removeGroup: 'Delete group',
  confirmRemoveGroup: (n) => `Delete this group${n ? ` and its ${n} place${n === 1 ? '' : 's'}` : ''}? Tap again to delete.`,
  showOnMap: 'Show on map',
  moveTo: 'Move to',
  empty: 'Nothing saved yet. Open a place and tap Save, or find some in Discover.',
  emptyGroup: 'No places in this group yet. Open a place and tap Save to add it.',
  places: (n) => `${n} place${n === 1 ? '' : 's'}`,
  saveTo: 'Save to',
  savedTo: (g) => `Saved to ${g}`,
  removedFrom: (g) => `Removed from ${g}`,
  note: 'Note',
  link: 'Link',
  linkHint: 'A TikTok, Instagram, Facebook or other link about it',
  pins: 'Pins',
  myPlaces: 'My places',
  recents: 'Recent',
  clearRecents: 'Clear recent',
  favourites: 'Favourites',
  wantToGo: 'Want to go',
  done: 'Done',
  cancel: 'Cancel',
  saveBtn: 'Save',
  more: (n) => `${n} more`,
};

const MS: Words = {
  tab: 'Tempat',
  hint: 'Ketik jenis tempat untuk mencari yang paling terkenal di sekitar tengah peta, dengan foto dan sumbernya. Alihkan peta untuk mencari di tempat lain.',
  justNow: 'sebentar tadi',
  minAgo: (n) => `${n} minit lalu`,
  hAgo: (n) => `${n} jam lalu`,
  hereSaved: 'Tempat yang disimpan kekal di telefon ini bersama akaun anda.',
  saved: 'Disimpan',
  discover: 'Teroka',
  cats: { attractions: 'Tarikan', food: 'Makanan', resorts: 'Resort', themeparks: 'Taman tema', malls: 'Pusat beli-belah' },
  around: (km) => `Sekitar tengah peta, dalam ${km}`,
  updated: (ago) => `Dikemas kini ${ago}`,
  refresh: 'Muat semula',
  loading: 'Mencari tempat…',
  none: 'Tiada apa-apa di sekitar sini. Alihkan peta atau zum keluar, kemudian cuba lagi.',
  offline: 'Tiada internet: tempat dari telefon ini, tanpa foto.',
  pickBadge: 'Pilihan pengembara',
  sources: 'Sumber',
  lookUp: 'Cari di',
  photoFrom: 'Foto',
  aboutFrom: (src) => `Daripada ${src}`,
  credits: 'Tempat daripada penyumbang OpenStreetMap (ODbL), Wikivoyage dan Wikipedia (CC BY-SA), foto daripada Wikimedia Commons. Halaman media sosial seperti tersenarai di OpenStreetMap.',
  partial: (names) => `${names} tidak dapat dihubungi; yang lain dipaparkan.`,
  home: 'Rumah',
  work: 'Tempat kerja',
  groups: 'Kumpulan',
  newGroup: 'Kumpulan baharu',
  groupName: 'Nama kumpulan',
  create: 'Cipta',
  rename: 'Tukar nama',
  remove: 'Buang',
  removeGroup: 'Padam kumpulan',
  confirmRemoveGroup: (n) => `Padam kumpulan ini${n ? ` dan ${n} tempat di dalamnya` : ''}? Ketik sekali lagi untuk memadam.`,
  showOnMap: 'Tunjuk di peta',
  moveTo: 'Pindah ke',
  empty: 'Belum ada yang disimpan. Buka tempat dan ketik Simpan, atau cari di Teroka.',
  emptyGroup: 'Belum ada tempat dalam kumpulan ini. Buka tempat dan ketik Simpan untuk menambahnya.',
  places: (n) => `${n} tempat`,
  saveTo: 'Simpan ke',
  savedTo: (g) => `Disimpan ke ${g}`,
  removedFrom: (g) => `Dibuang daripada ${g}`,
  note: 'Nota',
  link: 'Pautan',
  linkHint: 'Pautan TikTok, Instagram, Facebook atau lain-lain tentangnya',
  pins: 'Pin',
  myPlaces: 'Tempat saya',
  recents: 'Terkini',
  clearRecents: 'Kosongkan terkini',
  favourites: 'Kegemaran',
  wantToGo: 'Mahu pergi',
  done: 'Siap',
  cancel: 'Batal',
  saveBtn: 'Simpan',
  more: (n) => `${n} lagi`,
};

const JA: Words = {
  tab: 'スポット',
  hint: '種類をタップすると、地図の中心周辺の有名なスポットを写真と出典付きで表示します。別の場所を探すには地図を動かしてください。',
  justNow: 'たった今',
  minAgo: (n) => `${n}分前`,
  hAgo: (n) => `${n}時間前`,
  hereSaved: '保存したスポットはアカウントとともにこの端末に保存されます。',
  saved: '保存済み',
  discover: '発見',
  cats: { attractions: '観光スポット', food: 'グルメ', resorts: 'リゾート', themeparks: 'テーマパーク', malls: 'ショッピングモール' },
  around: (km) => `地図の中心から${km}以内`,
  updated: (ago) => `${ago}に更新`,
  refresh: '更新',
  loading: 'スポットを探しています…',
  none: 'この周辺には見つかりませんでした。地図を動かすか縮小してもう一度お試しください。',
  offline: 'インターネットに接続されていません。この端末のスポットを写真なしで表示します。',
  pickBadge: '旅行者のおすすめ',
  sources: '出典',
  lookUp: '調べる',
  photoFrom: '写真',
  aboutFrom: (src) => `出典: ${src}`,
  credits: 'スポット情報: OpenStreetMap 貢献者 (ODbL)、Wikivoyage と Wikipedia (CC BY-SA)、写真: Wikimedia Commons。SNS ページは OpenStreetMap の登録情報です。',
  partial: (names) => `${names}に接続できませんでした。ほかの結果を表示しています。`,
  home: '自宅',
  work: '職場',
  groups: 'グループ',
  newGroup: '新しいグループ',
  groupName: 'グループ名',
  create: '作成',
  rename: '名前を変更',
  remove: '削除',
  removeGroup: 'グループを削除',
  confirmRemoveGroup: (n) => `このグループ${n ? `と${n}件のスポット` : ''}を削除しますか？もう一度タップすると削除します。`,
  showOnMap: '地図に表示',
  moveTo: '移動先',
  empty: 'まだ何も保存されていません。スポットを開いて保存をタップするか、発見から探してください。',
  emptyGroup: 'このグループにはまだスポットがありません。スポットを開いて保存をタップすると追加できます。',
  places: (n) => `${n}件`,
  saveTo: '保存先',
  savedTo: (g) => `${g}に保存しました`,
  removedFrom: (g) => `${g}から削除しました`,
  note: 'メモ',
  link: 'リンク',
  linkHint: 'TikTok、Instagram、Facebook などのリンク',
  pins: 'ピン',
  myPlaces: 'マイスポット',
  recents: '履歴',
  clearRecents: '履歴を消去',
  favourites: 'お気に入り',
  wantToGo: '行きたい',
  done: '完了',
  cancel: 'キャンセル',
  saveBtn: '保存',
  more: (n) => `ほか${n}件`,
};

export function discoverWords(lang: LangCode): Words {
  return lang === 'ms' ? MS : lang === 'ja' ? JA : EN;
}

/** How each source is named in the place page. */
export const SOURCE_NAMES: Record<SourceKind, string> = {
  osm: 'OpenStreetMap',
  wikivoyage: 'Wikivoyage',
  wikipedia: 'Wikipedia',
  wikidata: 'Wikidata',
  commons: 'Wikimedia Commons',
  website: 'Website',
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  local: 'Places on this phone',
};
