import { describe, expect, it } from 'vitest';
import { decodeTopic, encodeTopic, formatToken, parseTokenAmount, shortAddress, topicLabel, TopicTooLongError, utf8ByteLength, ZERO_TOPIC } from '../src/text';

describe('utf8ByteLength', () => {
  it('counts bytes, not characters', () => {
    expect(utf8ByteLength('')).toBe(0);
    expect(utf8ByteLength('a')).toBe(1);
    expect(utf8ByteLength('é')).toBe(2);
    expect(utf8ByteLength('€')).toBe(3);
    expect(utf8ByteLength('😀')).toBe(4);
    expect(utf8ByteLength('a'.repeat(280))).toBe(280);
    expect(utf8ByteLength('😀'.repeat(70))).toBe(280);
    expect(utf8ByteLength('😀'.repeat(70) + 'a')).toBe(281);
  });
});

describe('topics', () => {
  it('encodes text as right-padded bytes32 and decodes it back', () => {
    const encoded = encodeTopic('general');
    expect(encoded).toHaveLength(66);
    expect(encoded.startsWith('0x67656e6572616c')).toBe(true);
    expect(decodeTopic(encoded)).toEqual({ label: 'general', isText: true, raw: encoded });
  });

  it('treats blank input as the zero topic', () => {
    expect(encodeTopic('')).toBe(ZERO_TOPIC);
    expect(encodeTopic('   ')).toBe(ZERO_TOPIC);
    expect(decodeTopic(ZERO_TOPIC)).toEqual({ label: '', isText: false, raw: ZERO_TOPIC });
  });

  it('accepts exactly 32 bytes and rejects 33', () => {
    expect(encodeTopic('a'.repeat(32))).toHaveLength(66);
    expect(() => encodeTopic('a'.repeat(33))).toThrow(TopicTooLongError);
    expect(() => encodeTopic('😀'.repeat(9))).toThrow(TopicTooLongError);
  });

  it('shows markup in topics as plain text', () => {
    const encoded = encodeTopic('<b onload=x>');
    expect(decodeTopic(encoded).label).toBe('<b onload=x>');
  });

  it('falls back to hex for binary or control-character topics', () => {
    const binary = `0x${'ff'.repeat(32)}` as const;
    expect(decodeTopic(binary)).toEqual({ label: binary, isText: false, raw: binary });
    const withNul = `0x${'41'}${'00'}${'42'}${'00'.repeat(29)}` as const;
    expect(decodeTopic(withNul).isText).toBe(false);
    const withControl = encodeTopic('a\u0007b');
    expect(decodeTopic(withControl).isText).toBe(false);
    expect(topicLabel(decodeTopic(binary))).toBe('0xffff…ffff');
    expect(topicLabel(decodeTopic(encodeTopic('general')))).toBe('general');
    expect(topicLabel(decodeTopic(ZERO_TOPIC))).toBe('');
  });
});

describe('amounts', () => {
  it('formats with separators and limited fraction digits', () => {
    expect(formatToken(0n, 18)).toBe('0');
    expect(formatToken(100n * 10n ** 18n, 18)).toBe('100');
    expect(formatToken(1_234_567n * 10n ** 18n, 18)).toBe('1,234,567');
    expect(formatToken(15n * 10n ** 17n, 18)).toBe('1.5');
    expect(formatToken(123456789n * 10n ** 12n, 18)).toBe('≈123.4567');
    expect(formatToken(1n, 18)).toBe('≈0.0000');
  });

  it('parses plain decimals and rejects everything else', () => {
    expect(parseTokenAmount('1', 18)).toBe(10n ** 18n);
    expect(parseTokenAmount(' 2.5 ', 18)).toBe(25n * 10n ** 17n);
    expect(parseTokenAmount('1,000', 18)).toBe(1000n * 10n ** 18n);
    expect(parseTokenAmount('', 18)).toBeNull();
    expect(parseTokenAmount('-1', 18)).toBeNull();
    expect(parseTokenAmount('1e5', 18)).toBeNull();
    expect(parseTokenAmount('abc', 18)).toBeNull();
    expect(parseTokenAmount('0.0000000000000000001', 18)).toBeNull();
  });

  it('shortens addresses', () => {
    expect(shortAddress('0x91b25f1835d6df5baa547130d88545b3d17e9fdc')).toBe('0x91b2…9fdc');
  });
});
