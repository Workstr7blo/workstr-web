// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { writeCards, type GridCard } from '../src/app/card-grid';

function grid(): Element {
  document.body.innerHTML = '<div id="grid"></div>';
  return document.getElementById('grid') as Element;
}

const card = (key: string, label = key): GridCard => ({
  key,
  html: `<div class="ex-card" data-address="${key}"><img class="card-photo" src="https://example.invalid/${key}.png" /><span>${label}</span></div>`
});

const keys = (host: Element): string[] => Array.from(host.children).map((child) => child.getAttribute('data-address') || '');

describe('writing a grid of cards', () => {
  let host: Element;
  beforeEach(() => { host = grid(); });

  it('writes cards into an empty grid', () => {
    writeCards(host, [card('a'), card('b')], '<div class="empty">none</div>', 'data-address');
    expect(keys(host)).toEqual(['a', 'b']);
  });

  // The whole point. A node that has not changed is the node the reader is looking at, and
  // for an exercise card that means the photo already painted rather than one fetched again.
  it('keeps the node, and its image, when a card has not changed', () => {
    writeCards(host, [card('a'), card('b')], '', 'data-address');
    const first = host.children[0];
    const image = host.querySelector('img');

    writeCards(host, [card('a'), card('b')], '', 'data-address');

    expect(host.children[0]).toBe(first);
    expect(host.querySelector('img')).toBe(image);
  });

  // Template markup and a node the parser has already serialised are not the same string,
  // so comparing them raw finds every card changed and preserves nothing.
  it('compares like for like rather than against raw template markup', () => {
    host.innerHTML = '<div class="ex-card" data-address="a"><img class="card-photo" src="https://example.invalid/a.png" /><span>a</span></div>';
    const existing = host.children[0];

    writeCards(host, [card('a')], '', 'data-address');

    expect(host.children[0]).toBe(existing);
  });

  it('replaces only the card whose content changed', () => {
    writeCards(host, [card('a'), card('b')], '', 'data-address');
    const kept = host.children[0];
    const changed = host.children[1];

    writeCards(host, [card('a'), card('b', 'Bench Press')], '', 'data-address');

    expect(host.children[0]).toBe(kept);
    expect(host.children[1]).not.toBe(changed);
    expect(host.children[1].textContent).toBe('Bench Press');
  });

  it('removes a card that is gone and keeps the rest', () => {
    writeCards(host, [card('a'), card('b'), card('c')], '', 'data-address');
    const a = host.children[0];
    const c = host.children[2];

    writeCards(host, [card('a'), card('c')], '', 'data-address');

    expect(keys(host)).toEqual(['a', 'c']);
    expect(host.children[0]).toBe(a);
    expect(host.children[1]).toBe(c);
  });

  it('reorders without rebuilding', () => {
    writeCards(host, [card('a'), card('b'), card('c')], '', 'data-address');
    const [a, b, c] = Array.from(host.children);

    writeCards(host, [card('c'), card('a'), card('b')], '', 'data-address');

    expect(keys(host)).toEqual(['c', 'a', 'b']);
    expect(host.children[0]).toBe(c);
    expect(host.children[1]).toBe(a);
    expect(host.children[2]).toBe(b);
  });

  it('inserts a new card among ones that stay', () => {
    writeCards(host, [card('a'), card('c')], '', 'data-address');
    const a = host.children[0];
    const c = host.children[1];

    writeCards(host, [card('a'), card('b'), card('c')], '', 'data-address');

    expect(keys(host)).toEqual(['a', 'b', 'c']);
    expect(host.children[0]).toBe(a);
    expect(host.children[2]).toBe(c);
  });

  it('writes the empty line when nothing matches, and cards again after', () => {
    writeCards(host, [card('a')], '<div class="empty">none</div>', 'data-address');
    writeCards(host, [], '<div class="empty">none</div>', 'data-address');
    expect(host.innerHTML).toBe('<div class="empty">none</div>');

    writeCards(host, [card('a')], '<div class="empty">none</div>', 'data-address');
    expect(keys(host)).toEqual(['a']);
  });

  // The library's empty line is a node of its own below the grid, so its grid empties to
  // nothing rather than to a message.
  it('empties to nothing when the caller has no empty markup', () => {
    writeCards(host, [card('a')], '', 'data-address');
    writeCards(host, [], '', 'data-address');
    expect(host.innerHTML).toBe('');
  });

  it('replaces whatever a page render left behind that carries no key', () => {
    host.innerHTML = '<div class="empty">none</div>';
    writeCards(host, [card('a')], '', 'data-address');
    expect(keys(host)).toEqual(['a']);
  });
});
