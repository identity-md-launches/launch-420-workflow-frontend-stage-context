// Text, topic and amount helpers. Everything here is pure and covered by unit tests.

import { formatUnits, hexToBytes, parseUnits, stringToHex, type Hex } from 'viem';
import { MAX_TOPIC_BYTES } from './config';

const encoder = new TextEncoder();
const strictDecoder = new TextDecoder('utf-8', { fatal: true });

export const ZERO_TOPIC: Hex = `0x${'0'.repeat(64)}`;

/** UTF-8 byte length, the unit the contract's body limit counts. */
export function utf8ByteLength(text: string): number {
  return encoder.encode(text).length;
}

export class TopicTooLongError extends Error {
  override name = 'TopicTooLongError';
}

/** Encodes a topic string as bytes32: UTF-8 bytes, right-padded with zeros. Empty means the zero topic. */
export function encodeTopic(topic: string): Hex {
  const trimmed = topic.trim();
  if (trimmed === '') return ZERO_TOPIC;
  const length = utf8ByteLength(trimmed);
  if (length > MAX_TOPIC_BYTES) throw new TopicTooLongError(`Topics are at most ${MAX_TOPIC_BYTES} bytes; this one is ${length}.`);
  return stringToHex(trimmed, { size: 32 });
}

export interface DecodedTopic {
  /** Human-readable label: decoded text, the raw hex, or "" for the zero topic. */
  label: string;
  /** True when the label is decoded text (rather than hex or empty). */
  isText: boolean;
  /** The bytes32 value as emitted. */
  raw: Hex;
}

// Control characters, bidi/zero-width marks and line separators are not shown as topic text.
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028\\u2029\\ufeff]');

/** Decodes a bytes32 topic for display. Non-text topics fall back to their hex form. */
export function decodeTopic(raw: Hex): DecodedTopic {
  const bytes = hexToBytes(raw);
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end -= 1;
  if (end === 0) return { label: '', isText: false, raw };
  const trimmed = bytes.subarray(0, end);
  if (trimmed.includes(0)) return { label: raw, isText: false, raw };
  try {
    const text = strictDecoder.decode(trimmed);
    if (CONTROL_CHARS.test(text)) return { label: raw, isText: false, raw };
    return { label: text, isText: true, raw };
  } catch {
    return { label: raw, isText: false, raw };
  }
}

/** Formats a token amount with at most `maxFraction` fractional digits and thousands separators. */
export function formatToken(value: bigint, decimals: number, maxFraction = 4): string {
  const negative = value < 0n;
  const text = formatUnits(negative ? -value : value, decimals);
  const [whole, fraction = ''] = text.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let cut = fraction.slice(0, maxFraction).replace(/0+$/, '');
  const truncated = fraction.length > maxFraction && fraction.slice(maxFraction).replace(/0+$/, '') !== '';
  if (truncated && cut === '') cut = '0'.repeat(maxFraction);
  const result = cut ? `${grouped}.${cut}` : grouped;
  return `${negative ? '-' : ''}${truncated ? '≈' : ''}${result}`;
}

/** Parses a decimal amount typed by a visitor. Returns null for anything that is not a plain positive decimal. */
export function parseTokenAmount(input: string, decimals: number): bigint | null {
  const trimmed = input.trim().replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const fraction = trimmed.split('.')[1] ?? '';
  if (fraction.length > decimals) return null;
  try {
    return parseUnits(trimmed, decimals);
  } catch {
    return null;
  }
}

/** Display label for a decoded topic: text as is, hex topics shortened, the zero topic as "". */
export function topicLabel(topic: DecodedTopic): string {
  if (topic.isText || topic.label === '') return topic.label;
  return `${topic.raw.slice(0, 6)}…${topic.raw.slice(-4)}`;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function formatTimestamp(seconds: bigint): string {
  if (seconds === 0n) return 'pending';
  return dateFormat.format(new Date(Number(seconds) * 1000));
}
