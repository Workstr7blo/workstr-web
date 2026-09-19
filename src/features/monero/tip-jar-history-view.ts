import { html } from '../../app/format';
import { PIGGY_BANK } from '../../app/piggy-bank';
import type { AppState } from '../../app/state';
import { recentActivity, tipJarCreatorName, tipJarCreatorPicture } from './tip-jar-history';
import type { TipJarActivity } from './types';
import { xmrAmount } from './wallet-view';

// An incoming row uses the piggy bank as its avatar: the money went into the Tip Jar, which is
// all Workstr can honestly say about where it came from.

// Plain directional arrows: out of the Tip Jar leans up and right, into it down and left.
const ARROW_OUT = '<path d="M7 17 17 7"/><path d="M8.5 7H17v8.5"/>';
const ARROW_IN = '<path d="M17 7 7 17"/><path d="M15.5 17H7V8.5"/>';
const PERSON = '<circle cx="12" cy="9" r="3.5"/><path d="M5.5 19.5c1.2-3 3.7-4.5 6.5-4.5s5.3 1.5 6.5 4.5"/>';

function glyph(paths: string, className: string): string {
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

// "Today", "Yesterday", "Sep 17", or "Sep 17, 2025" outside the current year, with the words a
// screen reader should say for the same day. Never a raw timestamp.
export function activityDay(date: Date, now: Date): { shown: string; spoken: string } {
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return { shown: 'Today', spoken: 'today' };
  if (days === 1) return { shown: 'Yesterday', spoken: 'yesterday' };
  const year = date.getFullYear() === now.getFullYear() ? '' : `, ${date.getFullYear()}`;
  return { shown: `${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}${year}`, spoken: `${MONTHS_LONG[date.getMonth()]} ${date.getDate()}${year}` };
}

export function activityTime(date: Date): string {
  const hours = date.getHours();
  return `${hours % 12 || 12}:${String(date.getMinutes()).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
}

interface RowParts {
  name: string;
  context: string;
  avatar: string;
  spoken: string;
}

function initial(name: string): string {
  return html(name.trim().slice(0, 1).toUpperCase() || '?');
}

function avatarFallback(name: string): string {
  return `<span class="tip-jar-activity-avatar-fallback">${initial(name)}</span>`;
}

function parts(record: TipJarActivity, state: AppState): RowParts {
  const amount = xmrAmount(record.amountAtomic);
  if (record.direction === 'in') {
    return { name: 'Received', context: '', avatar: `<span class="tip-jar-activity-avatar is-jar">${glyph(PIGGY_BANK, 'tip-jar-activity-glyph')}</span>`, spoken: `Received ${amount}` };
  }
  const pubkey = record.recipientPubkey;
  if (!pubkey) {
    return { name: 'Sent', context: '', avatar: `<span class="tip-jar-activity-avatar is-generic">${glyph(PERSON, 'tip-jar-activity-glyph')}</span>`, spoken: `Sent ${amount}` };
  }
  const name = tipJarCreatorName(pubkey, state, record.nameSnapshot);
  const picture = tipJarCreatorPicture(pubkey, state, record.pictureSnapshot);
  // A picture that fails to load becomes the initial, as author pills elsewhere do.
  const avatar = picture
    ? `<span class="tip-jar-activity-avatar"><img src="${html(picture)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'tip-jar-activity-avatar-fallback',textContent:'${initial(name)}'}))"></span>`
    : `<span class="tip-jar-activity-avatar">${avatarFallback(name)}</span>`;
  const context = record.programName ? `Tip for ${record.programName}` : 'Tip';
  return { name, context, avatar, spoken: `Sent ${amount} to ${name}${record.programName ? ` for ${record.programName}` : ''}` };
}

function stateWord(record: TipJarActivity): string {
  if (record.state === 'failed') return 'Failed';
  return record.state === 'submitted' ? 'Pending' : '';
}

function activityRow(record: TipJarActivity, state: AppState, now: Date): string {
  const date = new Date(record.createdAt);
  const day = activityDay(date, now);
  const time = activityTime(date);
  const { name, context, avatar, spoken } = parts(record, state);
  const status = stateWord(record);
  // The row is read as one sentence; the arrow and the layout are for sighted readers only.
  const sentence = `${spoken}, ${day.spoken} at ${time}${status ? `. ${status}` : ''}.`;
  return `<li class="tip-jar-activity-row" data-direction="${record.direction}" data-state="${record.state}">
    <span class="sr-only">${html(sentence)}</span>
    <span class="tip-jar-activity-arrow" aria-hidden="true">${glyph(record.direction === 'out' ? ARROW_OUT : ARROW_IN, 'tip-jar-activity-arrow-icon')}</span>
    <span aria-hidden="true">${avatar}</span>
    <span class="tip-jar-activity-main" aria-hidden="true">
      <span class="tip-jar-activity-name">${html(name)}</span>
      <span class="tip-jar-activity-amount">${html(xmrAmount(record.amountAtomic))}</span>
      ${context ? `<span class="tip-jar-activity-context">${html(context)}</span>` : ''}
    </span>
    <span class="tip-jar-activity-when" aria-hidden="true">
      <span>${html(day.shown)}</span>
      <span>${html(time)}</span>
      ${status ? `<span class="tip-jar-activity-state">${html(status)}</span>` : ''}
    </span>
  </li>`;
}

// The card's contents: the newest few transactions, or one line saying there are none.
export function tipJarActivityBody(state: AppState, now = new Date()): string {
  const rows = recentActivity(state.pubkey && state.tipJarActivity?.pubkey === state.pubkey ? state.tipJarActivity.records : []);
  const list = rows.length
    ? `<ol class="tip-jar-activity-list">${rows.map((record) => activityRow(record, state, now)).join('')}</ol>`
    : '<p class="tip-jar-activity-empty">No Tip Jar activity yet.</p>';
  return `<h2 class="tip-jar-activity-title" id="tip-jar-activity-title">Recent activity</h2>${list}`;
}

export function tipJarActivityCard(state: AppState, now = new Date()): string {
  return `<section class="tip-jar-card tip-jar-activity" id="tip-jar-activity" aria-labelledby="tip-jar-activity-title">${tipJarActivityBody(state, now)}</section>`;
}

// The markup each card was last given, so a sync that changed nothing on screen writes nothing.
const painted = new WeakMap<Element, string>();

export function updateTipJarActivity(root: ParentNode, state: AppState, now = new Date()): void {
  const card = root.querySelector('#tip-jar-activity');
  if (!card) return;
  const markup = tipJarActivityBody(state, now);
  if (painted.get(card) === markup) return;
  painted.set(card, markup);
  card.innerHTML = markup;
}
