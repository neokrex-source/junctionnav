/**
 * What pays the toll in each country, and how the voice and the screen name it: Touch 'n Go in
 * Malaysia, ETC in Japan and China, Easy Pass or M-Pass in Thailand, an e-toll card in Indonesia,
 * Autosweep or Easytrip in the Philippines, VETC or ePass in Vietnam, Hi-pass in Korea, eTag in
 * Taiwan, HKeToll in Hong Kong, FASTag in India, M-Tag in Pakistan.
 */
import type { LangCode } from '../routing/instructions';

export type TollPay = 'tng' | 'etc' | 'easypass' | 'etoll' | 'phrfid' | 'vietc' | 'hipass' | 'etag' | 'hketoll' | 'fastag' | 'mtag' | 'generic' | 'none';

export interface PayWords {
  /** On the toll chip ("Touch 'n Go"). */
  label: string;
  /** What to have ready ("your Touch n Go card"). */
  card: string;
  /** What to check before a long drive ("your Touch n Go balance"). */
  balance: string;
  /** The lanes to keep to at the plaza, where there are lanes for it. */
  lane: string | null;
}

type Table = Record<Exclude<TollPay, 'generic' | 'none'>, PayWords>;

const EN: Table = {
  tng: { label: "Touch 'n Go", card: 'your Touch n Go card', balance: 'your Touch n Go balance', lane: 'the Touch n Go lanes' },
  etc: { label: 'ETC', card: 'your ETC card', balance: 'your ETC card', lane: 'the ETC lane' },
  easypass: { label: 'Easy Pass / M-Pass', card: 'your Easy Pass or M-Pass', balance: 'your Easy Pass or M-Pass balance', lane: 'the Easy Pass or M-Pass lanes' },
  etoll: { label: 'e-toll card', card: 'your e-toll card', balance: 'your e-toll card balance', lane: null },
  phrfid: { label: 'Autosweep / Easytrip', card: 'your Autosweep or Easytrip RFID', balance: 'your Autosweep or Easytrip load', lane: 'the RFID lanes' },
  vietc: { label: 'ETC (VETC / ePass)', card: 'your ETC tag (VETC or ePass)', balance: 'your VETC or ePass balance', lane: 'the ETC lane' },
  hipass: { label: 'Hi-pass', card: 'your Hi-pass card', balance: 'your Hi-pass balance', lane: 'the Hi-pass lane' },
  etag: { label: 'eTag', card: 'your eTag', balance: 'your eTag balance', lane: null },
  hketoll: { label: 'HKeToll', card: 'your HKeToll tag', balance: 'your HKeToll account', lane: null },
  fastag: { label: 'FASTag', card: 'your FASTag', balance: 'your FASTag balance', lane: 'the FASTag lane' },
  mtag: { label: 'M-Tag', card: 'your M-Tag', balance: 'your M-Tag balance', lane: 'the M-Tag lane' },
};

const MS: Table = {
  tng: { label: "Touch 'n Go", card: 'kad Touch n Go anda', balance: 'baki kad Touch n Go', lane: 'lorong Touch n Go' },
  etc: { label: 'ETC', card: 'kad ETC anda', balance: 'kad ETC', lane: 'lorong ETC' },
  easypass: { label: 'Easy Pass / M-Pass', card: 'Easy Pass atau M-Pass anda', balance: 'baki Easy Pass atau M-Pass', lane: 'lorong Easy Pass atau M-Pass' },
  etoll: { label: 'kad e-tol', card: 'kad e-tol anda', balance: 'baki kad e-tol', lane: null },
  phrfid: { label: 'Autosweep / Easytrip', card: 'RFID Autosweep atau Easytrip anda', balance: 'baki Autosweep atau Easytrip', lane: 'lorong RFID' },
  vietc: { label: 'ETC (VETC / ePass)', card: 'tag ETC anda (VETC atau ePass)', balance: 'baki VETC atau ePass', lane: 'lorong ETC' },
  hipass: { label: 'Hi-pass', card: 'kad Hi-pass anda', balance: 'baki Hi-pass', lane: 'lorong Hi-pass' },
  etag: { label: 'eTag', card: 'eTag anda', balance: 'baki eTag', lane: null },
  hketoll: { label: 'HKeToll', card: 'tag HKeToll anda', balance: 'akaun HKeToll', lane: null },
  fastag: { label: 'FASTag', card: 'FASTag anda', balance: 'baki FASTag', lane: 'lorong FASTag' },
  mtag: { label: 'M-Tag', card: 'M-Tag anda', balance: 'baki M-Tag', lane: 'lorong M-Tag' },
};

const JA: Table = {
  tng: { label: "Touch 'n Go", card: 'Touch n Goカード', balance: 'Touch n Goカードの残高', lane: 'Touch n Goのレーン' },
  etc: { label: 'ETC', card: 'ETCカード', balance: 'ETCカード', lane: 'ETCレーン' },
  easypass: { label: 'Easy Pass・M-Pass', card: 'Easy PassまたはM-Pass', balance: 'Easy PassまたはM-Passの残高', lane: 'Easy Pass・M-Passのレーン' },
  etoll: { label: 'e-tollカード', card: 'e-tollカード', balance: 'e-tollカードの残高', lane: null },
  phrfid: { label: 'Autosweep・Easytrip', card: 'AutosweepまたはEasytripのRFID', balance: 'AutosweepまたはEasytripの残高', lane: 'RFIDレーン' },
  vietc: { label: 'ETC（VETC・ePass）', card: 'ETCタグ（VETCまたはePass）', balance: 'VETCまたはePassの残高', lane: 'ETCレーン' },
  hipass: { label: 'ハイパス', card: 'ハイパスカード', balance: 'ハイパスの残高', lane: 'ハイパスレーン' },
  etag: { label: 'eTag', card: 'eTag', balance: 'eTagの残高', lane: null },
  hketoll: { label: 'HKeToll', card: 'HKeTollタグ', balance: 'HKeTollアカウント', lane: null },
  fastag: { label: 'FASTag', card: 'FASTag', balance: 'FASTagの残高', lane: 'FASTagレーン' },
  mtag: { label: 'M-Tag', card: 'M-Tag', balance: 'M-Tagの残高', lane: 'M-Tagレーン' },
};

/** How a toll payment is named in a language (null for a plain reminder or none). */
export function payWords(pay: TollPay, lang: LangCode): PayWords | null {
  if (pay === 'generic' || pay === 'none') return null;
  return (lang === 'ms' ? MS : lang === 'ja' ? JA : EN)[pay];
}

/** The payment system of a country (ISO alpha-2). */
export function payFor(country: string | null): TollPay {
  switch (country) {
    case 'MY':
      return 'tng';
    case 'JP':
    case 'CN':
      return 'etc';
    case 'TH':
      return 'easypass';
    case 'ID':
      return 'etoll';
    case 'PH':
      return 'phrfid';
    case 'VN':
      return 'vietc';
    case 'KR':
      return 'hipass';
    case 'TW':
      return 'etag';
    case 'HK':
      return 'hketoll';
    case 'IN':
      return 'fastag';
    case 'PK':
      return 'mtag';
    // No toll plazas: road pricing is automatic (Singapore) or there are no toll roads (Brunei).
    case 'SG':
    case 'BN':
      return 'none';
    default:
      return 'generic';
  }
}
